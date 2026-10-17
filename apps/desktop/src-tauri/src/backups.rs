//! Running backups with history, and the scheduler that starts them (ADR-0034).

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use odin_core::CoreError;
use odin_core::backup::history;
use odin_core::backup::schedule::{self, ScheduleId};
use odin_core::backup::{
    self, BackupRequest, DatabaseTools, ToolConnection, ToolEvent, ToolSummary,
};
use odin_core::operations::CancellationToken;
use odin_core::profiles::ProfileId;
use tauri::AppHandle;
use tauri_specta::Event;
use tokio::sync::mpsc;

use crate::events::BackupsChanged;
use crate::state::{AppState, blocking, credentials_for_profile};

const CHECK_INTERVAL: Duration = Duration::from_secs(30);

/// A backup about to run: what, where, and for which schedule if any.
pub struct BackupJob {
    pub profile_id: ProfileId,
    pub schedule: Option<(ScheduleId, u32)>,
    pub request: BackupRequest,
    pub archive: PathBuf,
}

/// Runs mongodump for `job`, recording it in the history and telling the UI.
/// The run is recorded before anything can fail, so every failure is visible
/// there (and a schedule does not retry in a loop).
pub async fn run_backup(
    app: &AppHandle,
    state: &Arc<AppState>,
    tools: &DatabaseTools,
    job: BackupJob,
    output: mpsc::Sender<ToolEvent>,
    cancel: CancellationToken,
) -> Result<ToolSummary, CoreError> {
    let (profile_id, schedule, scope, archive) = (
        job.profile_id,
        job.schedule.map(|(id, _)| id),
        job.request.scope.clone(),
        job.archive.clone(),
    );
    let run = blocking(state, move |s| {
        history::start_run(&s.storage, profile_id, schedule, &scope, &archive)
    })
    .await?;
    changed(app);

    let outcome = async {
        let credentials = credentials_for_profile(state, job.profile_id).await?;
        if let Some(folder) = job.archive.parent() {
            std::fs::create_dir_all(folder).map_err(|error| {
                CoreError::Internal(format!("cannot create the backup folder: {error}"))
            })?;
        }
        let connection = ToolConnection {
            uri: &credentials.uri,
            password: credentials.password.as_ref(),
            read_only: credentials.read_only,
        };
        backup::backup(
            tools,
            connection,
            &job.request,
            &job.archive,
            output,
            cancel,
        )
        .await
    }
    .await;

    let recorded = outcome.as_ref().map(Clone::clone).map_err(clone_error);
    let keep = job.schedule;
    blocking(state, move |s| {
        history::finish_run(&s.storage, run, &recorded)?;
        if let (Ok(_), Some((schedule, keep))) = (&recorded, keep) {
            history::prune(&s.storage, schedule, keep)?;
        }
        Ok(())
    })
    .await?;
    changed(app);
    outcome
}

/// `CoreError` is not `Clone`; history only needs its kind and message.
fn clone_error(error: &CoreError) -> CoreError {
    match error {
        CoreError::Cancelled => CoreError::Cancelled,
        other => CoreError::Internal(other.to_string()),
    }
}

fn changed(app: &AppHandle) {
    let _ = BackupsChanged {}.emit(app);
}

/// Checks for due schedules every 30 seconds for the app's lifetime. Missed
/// runs (the app was closed) start once, shortly after launch.
pub fn spawn_scheduler(
    app: AppHandle,
    state: Arc<AppState>,
    tools: impl Fn() -> Option<DatabaseTools> + Send + 'static,
) {
    let running: Arc<Mutex<HashSet<ScheduleId>>> = Arc::default();
    tauri::async_runtime::spawn(async move {
        let _ = blocking(&state, |s| history::mark_interrupted(&s.storage)).await;
        loop {
            let due = blocking(&state, |s| schedule::due_schedules(&s.storage)).await;
            for (schedule_id, _) in due.unwrap_or_default() {
                let claimed = running
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .insert(schedule_id);
                if !claimed {
                    continue;
                }
                let (app, state, running) = (app.clone(), Arc::clone(&state), Arc::clone(&running));
                let tools = tools();
                tauri::async_runtime::spawn(async move {
                    // Failures, including missing tools, are recorded in the history.
                    let _ = match tools {
                        Some(tools) => run_schedule(&app, &state, &tools, schedule_id).await,
                        None => record_failure(&app, &state, schedule_id, missing_tools()).await,
                    };
                    running
                        .lock()
                        .unwrap_or_else(PoisonError::into_inner)
                        .remove(&schedule_id);
                });
            }
            tokio::time::sleep(CHECK_INTERVAL).await;
        }
    });
}

fn missing_tools() -> CoreError {
    CoreError::NotFound("MongoDB Database Tools (mongodump and mongorestore)")
}

/// Records a scheduled run that could not start, so the user sees why.
async fn record_failure(
    app: &AppHandle,
    state: &Arc<AppState>,
    id: ScheduleId,
    error: CoreError,
) -> Result<ToolSummary, CoreError> {
    let message = error.to_string();
    blocking(state, move |s| {
        let target = schedule::schedule_target(&s.storage, id)?;
        let run = history::start_run(
            &s.storage,
            target.profile_id,
            Some(id),
            &target.scope,
            &target.folder,
        )?;
        history::finish_run(&s.storage, run, &Err(CoreError::Internal(message)))
    })
    .await?;
    changed(app);
    Err(error)
}

/// Runs one schedule now, whether or not it is due.
pub async fn run_schedule(
    app: &AppHandle,
    state: &Arc<AppState>,
    tools: &DatabaseTools,
    id: ScheduleId,
) -> Result<ToolSummary, CoreError> {
    let (schedule, profile) = blocking(state, move |s| {
        let schedule = schedule::schedule_target(&s.storage, id)?;
        let profile =
            odin_core::profiles::get(&s.storage, s.secrets.as_ref(), schedule.profile_id)?;
        Ok((schedule, profile))
    })
    .await?;
    let archive = history::archive_path(
        &schedule.folder,
        &profile.name,
        &schedule.scope,
        &jiff::Zoned::now(),
    );
    let job = BackupJob {
        profile_id: schedule.profile_id,
        schedule: Some((schedule.id, schedule.keep)),
        request: BackupRequest::of(schedule.scope),
        archive,
    };
    // Scheduled runs have no window to stream output to.
    let (output, mut drain) = mpsc::channel(64);
    tauri::async_runtime::spawn(async move { while drain.recv().await.is_some() {} });
    run_backup(app, state, tools, job, output, CancellationToken::new()).await
}
