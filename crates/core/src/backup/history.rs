//! A record of every backup, manual or scheduled (ADR-0034).

use std::fmt;
use std::path::{Path, PathBuf};

use jiff::Zoned;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::schedule::ScheduleId;
use super::{BackupScope, ToolSummary};
use crate::CoreError;
use crate::profiles::ProfileId;
use crate::storage::Storage;

const HISTORY_LIMIT: u32 = 500;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(transparent)]
pub struct RunId(Uuid);

impl RunId {
    pub(crate) fn parse(value: &str) -> Result<Self, CoreError> {
        Uuid::parse_str(value)
            .map(Self)
            .map_err(|error| CoreError::Storage(format!("corrupt backup id: {error}")))
    }
}

impl fmt::Display for RunId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum RunStatus {
    Running,
    Completed,
    Failed,
    Cancelled,
}

impl RunStatus {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Running => "running",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }

    pub(crate) fn parse(value: &str) -> Result<Self, CoreError> {
        match value {
            "running" => Ok(Self::Running),
            "completed" => Ok(Self::Completed),
            "failed" => Ok(Self::Failed),
            "cancelled" => Ok(Self::Cancelled),
            other => Err(CoreError::Storage(format!("unknown backup status {other}"))),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct BackupRun {
    pub id: RunId,
    pub profile_id: ProfileId,
    pub schedule_id: Option<ScheduleId>,
    pub scope: BackupScope,
    /// Shown to the user; actions refer to the run by id (ADR-0017).
    pub archive: String,
    /// Whether the archive is still on disk.
    pub archive_exists: bool,
    /// Unix milliseconds.
    pub started_at: f64,
    pub finished_at: Option<f64>,
    pub status: RunStatus,
    pub bytes: f64,
    pub collections: f64,
    pub documents: f64,
    pub error: Option<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct StoredRun {
    pub id: RunId,
    pub profile_id: ProfileId,
    pub schedule_id: Option<ScheduleId>,
    pub scope: BackupScope,
    pub archive: PathBuf,
    pub started_at: i64,
    pub finished_at: Option<i64>,
    pub status: RunStatus,
    pub bytes: i64,
    pub collections: i64,
    pub documents: i64,
    pub error: Option<String>,
}

/// Records a backup that is starting.
pub fn start_run(
    storage: &Storage,
    profile_id: ProfileId,
    schedule_id: Option<ScheduleId>,
    scope: &BackupScope,
    archive: &Path,
) -> Result<RunId, CoreError> {
    let run = StoredRun {
        id: RunId(Uuid::now_v7()),
        profile_id,
        schedule_id,
        scope: scope.clone(),
        archive: archive.to_path_buf(),
        started_at: now_millis(),
        finished_at: None,
        status: RunStatus::Running,
        bytes: 0,
        collections: 0,
        documents: 0,
        error: None,
    };
    storage.insert_run(&run)?;
    if let Some(schedule) = schedule_id {
        storage.set_schedule_last_run(schedule, run.started_at)?;
    }
    Ok(run.id)
}

/// Records how a backup ended.
#[allow(clippy::cast_possible_truncation)]
pub fn finish_run(
    storage: &Storage,
    id: RunId,
    outcome: &Result<ToolSummary, CoreError>,
) -> Result<(), CoreError> {
    let mut run = storage.get_run(id)?;
    run.finished_at = Some(now_millis());
    match outcome {
        Ok(summary) => {
            run.status = RunStatus::Completed;
            run.collections = summary.collections as i64;
            run.documents = summary.documents as i64;
            run.bytes = std::fs::metadata(&run.archive)
                .map_or(0, |meta| i64::try_from(meta.len()).unwrap_or(i64::MAX));
        }
        Err(CoreError::Cancelled) => run.status = RunStatus::Cancelled,
        Err(error) => {
            run.status = RunStatus::Failed;
            run.error = Some(error.to_string());
        }
    }
    storage.update_run(&run)
}

/// Runs left `running` by a previous session that ended mid-backup.
pub fn mark_interrupted(storage: &Storage) -> Result<(), CoreError> {
    storage.fail_running_runs("odin-db closed before the backup finished")
}

pub fn list_runs(storage: &Storage) -> Result<Vec<BackupRun>, CoreError> {
    Ok(storage
        .list_runs(HISTORY_LIMIT)?
        .into_iter()
        .map(to_public)
        .collect())
}

/// The archive of a completed run, for restoring or revealing it.
pub fn run_archive(storage: &Storage, id: RunId) -> Result<PathBuf, CoreError> {
    let run = storage.get_run(id)?;
    if !run.archive.is_file() {
        return Err(CoreError::NotFound("backup archive"));
    }
    Ok(run.archive)
}

/// Forgets a run, and deletes its archive when asked.
pub fn delete_run(storage: &Storage, id: RunId, delete_archive: bool) -> Result<(), CoreError> {
    let run = storage.get_run(id)?;
    if run.status == RunStatus::Running {
        return Err(CoreError::Validation("this backup is still running".into()));
    }
    if delete_archive {
        remove_archive(&run.archive)?;
    }
    storage.delete_run(id)
}

/// Keeps the newest `keep` completed backups of a schedule, deleting the rest.
pub fn prune(storage: &Storage, schedule: ScheduleId, keep: u32) -> Result<usize, CoreError> {
    let old = storage.completed_runs_of_schedule(schedule, keep)?;
    for run in &old {
        remove_archive(&run.archive)?;
        storage.delete_run(run.id)?;
    }
    Ok(old.len())
}

fn remove_archive(path: &Path) -> Result<(), CoreError> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(CoreError::Internal(format!(
            "cannot delete {}: {error}",
            path.display()
        ))),
    }
}

/// `<folder>/<profile>_<scope>_<date>_<time>.archive.gz`, in local time so the
/// names sort and read naturally.
#[must_use]
pub fn archive_path(
    folder: &Path,
    profile_name: &str,
    scope: &BackupScope,
    now: &Zoned,
) -> PathBuf {
    let scope = match scope {
        BackupScope::Deployment => "all".to_owned(),
        BackupScope::Database { database } => database.clone(),
        BackupScope::Collection {
            database,
            collection,
        } => format!("{database}.{collection}"),
    };
    let stamp = now.strftime("%Y-%m-%d_%H%M%S");
    folder.join(format!(
        "{}_{}_{stamp}.archive.gz",
        slug(profile_name),
        slug(&scope)
    ))
}

/// Safe in file names on every OS.
fn slug(text: &str) -> String {
    let cleaned: String = text
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || matches!(c, '.' | '-') {
                c
            } else {
                '-'
            }
        })
        .collect();
    let trimmed = cleaned.trim_matches('-');
    if trimmed.is_empty() {
        "backup".into()
    } else {
        trimmed.to_owned()
    }
}

fn now_millis() -> i64 {
    Zoned::now().timestamp().as_millisecond()
}

#[allow(clippy::cast_precision_loss)]
fn to_public(run: StoredRun) -> BackupRun {
    BackupRun {
        id: run.id,
        profile_id: run.profile_id,
        schedule_id: run.schedule_id,
        scope: run.scope,
        archive_exists: run.archive.is_file(),
        archive: run.archive.display().to_string(),
        started_at: run.started_at as f64,
        finished_at: run.finished_at.map(|at| at as f64),
        status: run.status,
        bytes: run.bytes as f64,
        collections: run.collections as f64,
        documents: run.documents as f64,
        error: run.error,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn archive_names_are_readable_and_safe() {
        let now: Zoned = "2026-10-17T02:00:05[Europe/Rome]".parse().unwrap();
        let path = archive_path(
            Path::new("/backups"),
            "Production (Atlas)",
            &BackupScope::Collection {
                database: "shop".into(),
                collection: "orders/2026".into(),
            },
            &now,
        );
        assert_eq!(
            path,
            Path::new("/backups/Production--Atlas_shop.orders-2026_2026-10-17_020005.archive.gz")
        );
    }

    #[test]
    fn records_runs_prunes_old_ones_and_follows_profile_deletion() {
        use crate::backup::schedule::{self, Frequency, ScheduleInput, Timing};
        use crate::profiles::{self, ProfileInput};
        use crate::secrets::MemoryStore;

        let storage = Storage::open_in_memory().unwrap();
        let secrets = MemoryStore::default();
        let profile = profiles::create(
            &storage,
            &secrets,
            ProfileInput {
                name: "Local".into(),
                connection_string: "mongodb://localhost:27017".into(),
                password: None,
                read_only: false,
                color: None,
                ssh: None,
                ssh_secret: None,
                ssh_host_key: None,
                group: None,
            },
        )
        .unwrap();
        let folder = std::env::temp_dir().join(format!("odin-history-{}", Uuid::now_v7()));
        std::fs::create_dir_all(&folder).unwrap();
        let created = schedule::create_schedule(
            &storage,
            ScheduleInput {
                profile_id: profile.id,
                scope: BackupScope::Deployment,
                timing: Timing {
                    frequency: Frequency::Daily,
                    minute: 120,
                    weekday: None,
                },
                keep: 2,
                enabled: true,
            },
            &folder,
        )
        .unwrap();

        let summary = ToolSummary {
            collections: 3.0,
            documents: 10.0,
            failures: 0.0,
        };
        let mut archives = Vec::new();
        for i in 0..3 {
            let archive = folder.join(format!("run-{i}.archive.gz"));
            std::fs::write(&archive, b"data").unwrap();
            let id = start_run(
                &storage,
                profile.id,
                Some(created.id),
                &BackupScope::Deployment,
                &archive,
            )
            .unwrap();
            finish_run(&storage, id, &Ok(summary.clone())).unwrap();
            archives.push(archive);
            std::thread::sleep(std::time::Duration::from_millis(2));
        }
        let failed = start_run(
            &storage,
            profile.id,
            None,
            &BackupScope::Deployment,
            &folder.join("x"),
        )
        .unwrap();
        finish_run(&storage, failed, &Err(CoreError::Network("down".into()))).unwrap();

        let runs = list_runs(&storage).unwrap();
        assert_eq!(runs.len(), 4);
        assert_eq!(runs[0].status, RunStatus::Failed, "newest first");
        assert_eq!(runs[1].bytes, 4.0);
        assert!(
            schedule::list_schedules(&storage).unwrap()[0]
                .last_run_at
                .is_some()
        );

        assert_eq!(prune(&storage, created.id, 2).unwrap(), 1);
        assert!(!archives[0].exists(), "the oldest archive is deleted");
        assert!(archives[2].exists());
        assert_eq!(list_runs(&storage).unwrap().len(), 3);

        profiles::delete(&storage, &secrets, profile.id).unwrap();
        assert!(list_runs(&storage).unwrap().is_empty());
        assert!(schedule::list_schedules(&storage).unwrap().is_empty());
        std::fs::remove_dir_all(folder).unwrap();
    }
}
