//! Local SQLite persistence with forward-only migrations (ADR-0016).

use std::path::Path;
use std::sync::{Mutex, MutexGuard, PoisonError};

use rusqlite::{Connection, OptionalExtension, params};
use rusqlite_migration::{M, Migrations};

use crate::CoreError;
use crate::backup::BackupScope;
use crate::backup::history::{RunId, RunStatus, StoredRun};
use crate::backup::schedule::{Frequency, ScheduleId, StoredSchedule, Timing};
use crate::profiles::{ProfileColor, ProfileId, StoredProfile};

const MIGRATIONS: &[M<'static>] = &[
    M::up(
        "CREATE TABLE connection_profiles (
            id TEXT PRIMARY KEY NOT NULL,
            name TEXT NOT NULL,
            connection_string TEXT NOT NULL,
            read_only INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL DEFAULT (unixepoch()),
            updated_at INTEGER NOT NULL DEFAULT (unixepoch())
        ) STRICT;",
    ),
    // Backup history and schedules (ADR-0034). Times are Unix milliseconds.
    M::up(
        "CREATE TABLE backup_schedules (
            id TEXT PRIMARY KEY NOT NULL,
            profile_id TEXT NOT NULL REFERENCES connection_profiles(id) ON DELETE CASCADE,
            scope TEXT NOT NULL,
            folder TEXT NOT NULL,
            frequency TEXT NOT NULL,
            minute INTEGER NOT NULL,
            weekday INTEGER,
            keep INTEGER NOT NULL,
            enabled INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            last_run_at INTEGER
        ) STRICT;
        CREATE TABLE backup_runs (
            id TEXT PRIMARY KEY NOT NULL,
            profile_id TEXT NOT NULL REFERENCES connection_profiles(id) ON DELETE CASCADE,
            schedule_id TEXT REFERENCES backup_schedules(id) ON DELETE SET NULL,
            scope TEXT NOT NULL,
            archive TEXT NOT NULL,
            started_at INTEGER NOT NULL,
            finished_at INTEGER,
            status TEXT NOT NULL,
            bytes INTEGER NOT NULL DEFAULT 0,
            collections INTEGER NOT NULL DEFAULT 0,
            documents INTEGER NOT NULL DEFAULT 0,
            error TEXT
        ) STRICT;
        CREATE INDEX backup_runs_started ON backup_runs(started_at DESC);",
    ),
    M::up("ALTER TABLE connection_profiles ADD COLUMN color TEXT;"),
];

#[derive(Debug)]
pub struct Storage {
    connection: Mutex<Connection>,
}

impl Storage {
    pub fn open(path: &Path) -> Result<Self, CoreError> {
        Self::init(Connection::open(path)?)
    }

    pub fn open_in_memory() -> Result<Self, CoreError> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(mut connection: Connection) -> Result<Self, CoreError> {
        connection.pragma_update(None, "journal_mode", "WAL")?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        Migrations::from_slice(MIGRATIONS)
            .to_latest(&mut connection)
            .map_err(|error| CoreError::Storage(format!("migration failed: {error}")))?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    fn lock(&self) -> MutexGuard<'_, Connection> {
        // A panic mid-statement leaves SQLite itself consistent (transactions roll back).
        self.connection
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }

    pub(crate) fn list_profiles(&self) -> Result<Vec<StoredProfile>, CoreError> {
        let connection = self.lock();
        let mut statement = connection.prepare(
            "SELECT id, name, connection_string, read_only, color
             FROM connection_profiles ORDER BY name COLLATE NOCASE, created_at",
        )?;
        let rows = statement.query_map([], read_profile_row)?;
        rows.map(|row| to_profile(row?)).collect()
    }

    pub(crate) fn get_profile(&self, id: ProfileId) -> Result<StoredProfile, CoreError> {
        let row = self
            .lock()
            .query_row(
                "SELECT id, name, connection_string, read_only, color
                 FROM connection_profiles WHERE id = ?1",
                params![id.to_string()],
                read_profile_row,
            )
            .optional()?
            .ok_or(CoreError::NotFound("connection profile"))?;
        to_profile(row)
    }

    pub(crate) fn insert_profile(&self, profile: &StoredProfile) -> Result<(), CoreError> {
        self.lock().execute(
            "INSERT INTO connection_profiles (id, name, connection_string, read_only, color)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                profile.id.to_string(),
                profile.name,
                profile.connection_string,
                profile.read_only,
                profile.color.map(ProfileColor::as_str)
            ],
        )?;
        Ok(())
    }

    pub(crate) fn update_profile(&self, profile: &StoredProfile) -> Result<(), CoreError> {
        let changed = self.lock().execute(
            "UPDATE connection_profiles
             SET name = ?2, connection_string = ?3, read_only = ?4, color = ?5,
                 updated_at = unixepoch()
             WHERE id = ?1",
            params![
                profile.id.to_string(),
                profile.name,
                profile.connection_string,
                profile.read_only,
                profile.color.map(ProfileColor::as_str)
            ],
        )?;
        if changed == 0 {
            return Err(CoreError::NotFound("connection profile"));
        }
        Ok(())
    }

    pub(crate) fn delete_profile(&self, id: ProfileId) -> Result<(), CoreError> {
        self.lock().execute(
            "DELETE FROM connection_profiles WHERE id = ?1",
            params![id.to_string()],
        )?;
        Ok(())
    }
}

// Backup schedules and history (ADR-0034).
impl Storage {
    pub(crate) fn insert_schedule(&self, schedule: &StoredSchedule) -> Result<(), CoreError> {
        self.lock().execute(
            "INSERT INTO backup_schedules
             (id, profile_id, scope, folder, frequency, minute, weekday, keep, enabled, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                schedule.id.to_string(),
                schedule.profile_id.to_string(),
                scope_json(&schedule.scope)?,
                schedule.folder.to_string_lossy(),
                schedule.timing.frequency.as_str(),
                schedule.timing.minute,
                schedule.timing.weekday,
                schedule.keep,
                schedule.enabled,
                schedule.created_at,
            ],
        )?;
        Ok(())
    }

    pub(crate) fn update_schedule(&self, schedule: &StoredSchedule) -> Result<(), CoreError> {
        let changed = self.lock().execute(
            "UPDATE backup_schedules SET profile_id = ?2, scope = ?3, folder = ?4,
             frequency = ?5, minute = ?6, weekday = ?7, keep = ?8, enabled = ?9 WHERE id = ?1",
            params![
                schedule.id.to_string(),
                schedule.profile_id.to_string(),
                scope_json(&schedule.scope)?,
                schedule.folder.to_string_lossy(),
                schedule.timing.frequency.as_str(),
                schedule.timing.minute,
                schedule.timing.weekday,
                schedule.keep,
                schedule.enabled,
            ],
        )?;
        if changed == 0 {
            return Err(CoreError::NotFound("backup schedule"));
        }
        Ok(())
    }

    pub(crate) fn get_schedule(&self, id: ScheduleId) -> Result<StoredSchedule, CoreError> {
        self.lock()
            .query_row(
                &format!("{SCHEDULE_COLUMNS} WHERE s.id = ?1"),
                params![id.to_string()],
                read_schedule_row,
            )
            .optional()?
            .ok_or(CoreError::NotFound("backup schedule"))
            .and_then(to_schedule)
    }

    pub(crate) fn list_schedules(&self) -> Result<Vec<StoredSchedule>, CoreError> {
        let connection = self.lock();
        let mut statement =
            connection.prepare(&format!("{SCHEDULE_COLUMNS} ORDER BY s.created_at"))?;
        let rows = statement.query_map([], read_schedule_row)?;
        rows.map(|row| to_schedule(row?)).collect()
    }

    pub(crate) fn delete_schedule(&self, id: ScheduleId) -> Result<(), CoreError> {
        self.lock().execute(
            "DELETE FROM backup_schedules WHERE id = ?1",
            params![id.to_string()],
        )?;
        Ok(())
    }

    pub(crate) fn set_schedule_last_run(&self, id: ScheduleId, at: i64) -> Result<(), CoreError> {
        // Kept on the schedule itself, so pruning history never makes it run again.
        self.lock().execute(
            "UPDATE backup_schedules SET last_run_at = ?2 WHERE id = ?1",
            params![id.to_string(), at],
        )?;
        Ok(())
    }

    pub(crate) fn insert_run(&self, run: &StoredRun) -> Result<(), CoreError> {
        self.lock().execute(
            "INSERT INTO backup_runs (id, profile_id, schedule_id, scope, archive, started_at,
             finished_at, status, bytes, collections, documents, error)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                run.id.to_string(),
                run.profile_id.to_string(),
                run.schedule_id.map(|id| id.to_string()),
                scope_json(&run.scope)?,
                run.archive.to_string_lossy(),
                run.started_at,
                run.finished_at,
                run.status.as_str(),
                run.bytes,
                run.collections,
                run.documents,
                run.error,
            ],
        )?;
        Ok(())
    }

    pub(crate) fn update_run(&self, run: &StoredRun) -> Result<(), CoreError> {
        self.lock().execute(
            "UPDATE backup_runs SET finished_at = ?2, status = ?3, bytes = ?4, collections = ?5,
             documents = ?6, error = ?7 WHERE id = ?1",
            params![
                run.id.to_string(),
                run.finished_at,
                run.status.as_str(),
                run.bytes,
                run.collections,
                run.documents,
                run.error,
            ],
        )?;
        Ok(())
    }

    pub(crate) fn get_run(&self, id: RunId) -> Result<StoredRun, CoreError> {
        self.lock()
            .query_row(
                &format!("{RUN_COLUMNS} WHERE id = ?1"),
                params![id.to_string()],
                read_run_row,
            )
            .optional()?
            .ok_or(CoreError::NotFound("backup"))
            .and_then(to_run)
    }

    pub(crate) fn list_runs(&self, limit: u32) -> Result<Vec<StoredRun>, CoreError> {
        let connection = self.lock();
        let mut statement =
            connection.prepare(&format!("{RUN_COLUMNS} ORDER BY started_at DESC LIMIT ?1"))?;
        let rows = statement.query_map(params![limit], read_run_row)?;
        rows.map(|row| to_run(row?)).collect()
    }

    pub(crate) fn delete_run(&self, id: RunId) -> Result<(), CoreError> {
        self.lock().execute(
            "DELETE FROM backup_runs WHERE id = ?1",
            params![id.to_string()],
        )?;
        Ok(())
    }

    pub(crate) fn fail_running_runs(&self, message: &str) -> Result<(), CoreError> {
        self.lock().execute(
            "UPDATE backup_runs SET status = 'failed', error = ?1 WHERE status = 'running'",
            params![message],
        )?;
        Ok(())
    }

    /// Completed runs of a schedule beyond the newest `keep`.
    pub(crate) fn completed_runs_of_schedule(
        &self,
        schedule: ScheduleId,
        keep: u32,
    ) -> Result<Vec<StoredRun>, CoreError> {
        let connection = self.lock();
        let mut statement = connection.prepare(&format!(
            "{RUN_COLUMNS} WHERE schedule_id = ?1 AND status = 'completed'
             ORDER BY started_at DESC LIMIT -1 OFFSET ?2"
        ))?;
        let rows = statement.query_map(params![schedule.to_string(), keep], read_run_row)?;
        rows.map(|row| to_run(row?)).collect()
    }
}

const SCHEDULE_COLUMNS: &str =
    "SELECT s.id, s.profile_id, s.scope, s.folder, s.frequency, s.minute,
    s.weekday, s.keep, s.enabled, s.created_at, s.last_run_at FROM backup_schedules s";

type ScheduleRow = (
    String,
    String,
    String,
    String,
    String,
    u16,
    Option<u8>,
    u32,
    bool,
    i64,
    Option<i64>,
);

fn read_schedule_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ScheduleRow> {
    Ok((
        row.get(0)?,
        row.get(1)?,
        row.get(2)?,
        row.get(3)?,
        row.get(4)?,
        row.get(5)?,
        row.get(6)?,
        row.get(7)?,
        row.get(8)?,
        row.get(9)?,
        row.get(10)?,
    ))
}

fn to_schedule(row: ScheduleRow) -> Result<StoredSchedule, CoreError> {
    let (id, profile, scope, folder, frequency, minute, weekday, keep, enabled, created, last) =
        row;
    Ok(StoredSchedule {
        id: ScheduleId::parse(&id)?,
        profile_id: ProfileId::parse(&profile)?,
        scope: parse_scope(&scope)?,
        folder: folder.into(),
        timing: Timing {
            frequency: Frequency::parse(&frequency)?,
            minute,
            weekday,
        },
        keep,
        enabled,
        created_at: created,
        last_run_at: last,
    })
}

const RUN_COLUMNS: &str = "SELECT id, profile_id, schedule_id, scope, archive, started_at,
    finished_at, status, bytes, collections, documents, error FROM backup_runs";

type RunRow = (
    String,
    String,
    Option<String>,
    String,
    String,
    i64,
    Option<i64>,
    String,
    i64,
    i64,
    i64,
    Option<String>,
);

fn read_run_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RunRow> {
    Ok((
        row.get(0)?,
        row.get(1)?,
        row.get(2)?,
        row.get(3)?,
        row.get(4)?,
        row.get(5)?,
        row.get(6)?,
        row.get(7)?,
        row.get(8)?,
        row.get(9)?,
        row.get(10)?,
        row.get(11)?,
    ))
}

fn to_run(row: RunRow) -> Result<StoredRun, CoreError> {
    let (
        id,
        profile,
        schedule,
        scope,
        archive,
        started,
        finished,
        status,
        bytes,
        cols,
        docs,
        error,
    ) = row;
    Ok(StoredRun {
        id: RunId::parse(&id)?,
        profile_id: ProfileId::parse(&profile)?,
        schedule_id: schedule.as_deref().map(ScheduleId::parse).transpose()?,
        scope: parse_scope(&scope)?,
        archive: archive.into(),
        started_at: started,
        finished_at: finished,
        status: RunStatus::parse(&status)?,
        bytes,
        collections: cols,
        documents: docs,
        error,
    })
}

fn scope_json(scope: &BackupScope) -> Result<String, CoreError> {
    serde_json::to_string(scope).map_err(|error| CoreError::Internal(error.to_string()))
}

fn parse_scope(text: &str) -> Result<BackupScope, CoreError> {
    serde_json::from_str(text)
        .map_err(|error| CoreError::Storage(format!("corrupt scope: {error}")))
}

type ProfileRow = (String, String, String, bool, Option<String>);

fn read_profile_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ProfileRow> {
    Ok((
        row.get(0)?,
        row.get(1)?,
        row.get(2)?,
        row.get(3)?,
        row.get(4)?,
    ))
}

fn to_profile(
    (id, name, connection_string, read_only, color): ProfileRow,
) -> Result<StoredProfile, CoreError> {
    Ok(StoredProfile {
        id: ProfileId::parse(&id)?,
        name,
        connection_string,
        read_only,
        color: color.as_deref().and_then(ProfileColor::parse),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrations_are_valid() {
        assert!(Migrations::from_slice(MIGRATIONS).validate().is_ok());
    }

    #[test]
    fn missing_profile_is_not_found() {
        let storage = Storage::open_in_memory().expect("storage");
        assert!(matches!(
            storage.get_profile(ProfileId::new()),
            Err(CoreError::NotFound(_))
        ));
    }
}
