//! Backup history and schedules (ADR-0034).

use std::sync::{Arc, PoisonError};

use odin_core::CoreError;
use odin_core::backup::history::{self, BackupRun, RunId};
use odin_core::backup::schedule::{self, BackupSchedule, ScheduleId, ScheduleInput};
use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use super::backup::{PickedFile, remember_path, require_tools};
use crate::backups::run_schedule;
use crate::ipc::IpcError;
use crate::state::{AppState, blocking};

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PickedFolder {
    /// Opaque handle for `save_backup_schedule`; the path stays in the backend.
    pub token: String,
    /// For display only.
    pub path: String,
}

#[tauri::command]
#[specta::specta]
pub async fn list_backup_runs(state: State<'_, Arc<AppState>>) -> Result<Vec<BackupRun>, IpcError> {
    Ok(blocking(&state, |s| history::list_runs(&s.storage)).await?)
}

/// Forgets a backup; with `delete_archive` its file is deleted too.
#[tauri::command]
#[specta::specta]
pub async fn delete_backup_run(
    state: State<'_, Arc<AppState>>,
    id: RunId,
    delete_archive: bool,
) -> Result<(), IpcError> {
    Ok(blocking(&state, move |s| {
        history::delete_run(&s.storage, id, delete_archive)
    })
    .await?)
}

/// Shows the backup's archive in the system file manager.
#[tauri::command]
#[specta::specta]
pub async fn reveal_backup(state: State<'_, Arc<AppState>>, id: RunId) -> Result<(), IpcError> {
    let archive = blocking(&state, move |s| history::run_archive(&s.storage, id)).await?;
    tauri_plugin_opener::reveal_item_in_dir(archive)
        .map_err(|error| CoreError::Internal(format!("cannot open the file manager: {error}")))?;
    Ok(())
}

/// Picks a backup from the history as the source of a restore.
#[tauri::command]
#[specta::specta]
pub async fn restore_source_from_backup(
    state: State<'_, Arc<AppState>>,
    id: RunId,
) -> Result<PickedFile, IpcError> {
    let archive = blocking(&state, move |s| history::run_archive(&s.storage, id)).await?;
    let name = archive
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    Ok(PickedFile {
        token: remember_path(&state, archive),
        name,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn list_backup_schedules(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<BackupSchedule>, IpcError> {
    Ok(blocking(&state, |s| schedule::list_schedules(&s.storage)).await?)
}

/// Asks for the folder scheduled backups go to. `None` if the user cancels.
#[tauri::command]
#[specta::specta]
pub async fn choose_backup_folder(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<Option<PickedFolder>, IpcError> {
    let dialog = app.dialog().file();
    let picked = tauri::async_runtime::spawn_blocking(move || dialog.blocking_pick_folder())
        .await
        .map_err(|error| CoreError::Internal(error.to_string()))?;
    let Some(folder) = picked else {
        return Ok(None);
    };
    let folder = folder
        .into_path()
        .map_err(|error| CoreError::Validation(error.to_string()))?;
    Ok(Some(PickedFolder {
        path: folder.display().to_string(),
        token: remember_path(&state, folder),
    }))
}

/// Creates a schedule (`id: None`) or updates one. A new schedule needs a
/// folder token; an update without one keeps its folder.
#[tauri::command]
#[specta::specta]
pub async fn save_backup_schedule(
    state: State<'_, Arc<AppState>>,
    id: Option<ScheduleId>,
    input: ScheduleInput,
    folder_token: Option<String>,
) -> Result<BackupSchedule, IpcError> {
    let folder = folder_token
        .map(|token| {
            let token =
                uuid::Uuid::parse_str(&token).map_err(|_| CoreError::NotFound("backup folder"))?;
            state
                .picked_files
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .get(&token)
                .cloned()
                .ok_or(CoreError::NotFound("backup folder"))
        })
        .transpose()?;
    Ok(blocking(&state, move |s| match (id, folder) {
        (Some(id), folder) => schedule::update_schedule(&s.storage, id, input, folder.as_deref()),
        (None, Some(folder)) => schedule::create_schedule(&s.storage, input, &folder),
        (None, None) => Err(CoreError::Validation(
            "choose a folder for the backups".into(),
        )),
    })
    .await?)
}

#[tauri::command]
#[specta::specta]
pub async fn delete_backup_schedule(
    state: State<'_, Arc<AppState>>,
    id: ScheduleId,
) -> Result<(), IpcError> {
    Ok(blocking(&state, move |s| schedule::delete_schedule(&s.storage, id)).await?)
}

/// Starts a schedule's backup now, in the background; progress shows in the history.
#[tauri::command]
#[specta::specta]
pub fn run_backup_schedule_now(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    id: ScheduleId,
) -> Result<(), IpcError> {
    let tools = require_tools()?;
    let state = Arc::clone(&state);
    tauri::async_runtime::spawn(async move {
        // Failures are recorded in the backup history.
        let _ = run_schedule(&app, &state, &tools, id).await;
    });
    Ok(())
}
