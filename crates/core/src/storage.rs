//! Local SQLite persistence with forward-only migrations (ADR-0016).

use std::path::Path;
use std::sync::{Mutex, MutexGuard, PoisonError};

use rusqlite::{Connection, OptionalExtension, params};
use rusqlite_migration::{M, Migrations};

use crate::CoreError;
use crate::profiles::{ProfileId, StoredProfile};

const MIGRATIONS: &[M<'static>] = &[M::up(
    "CREATE TABLE connection_profiles (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        connection_string TEXT NOT NULL,
        read_only INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    ) STRICT;",
)];

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
            "SELECT id, name, connection_string, read_only
             FROM connection_profiles ORDER BY name COLLATE NOCASE, created_at",
        )?;
        let rows = statement.query_map([], read_profile_row)?;
        rows.map(|row| to_profile(row?)).collect()
    }

    pub(crate) fn get_profile(&self, id: ProfileId) -> Result<StoredProfile, CoreError> {
        let row = self
            .lock()
            .query_row(
                "SELECT id, name, connection_string, read_only
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
            "INSERT INTO connection_profiles (id, name, connection_string, read_only)
             VALUES (?1, ?2, ?3, ?4)",
            params![
                profile.id.to_string(),
                profile.name,
                profile.connection_string,
                profile.read_only
            ],
        )?;
        Ok(())
    }

    pub(crate) fn update_profile(&self, profile: &StoredProfile) -> Result<(), CoreError> {
        let changed = self.lock().execute(
            "UPDATE connection_profiles
             SET name = ?2, connection_string = ?3, read_only = ?4, updated_at = unixepoch()
             WHERE id = ?1",
            params![
                profile.id.to_string(),
                profile.name,
                profile.connection_string,
                profile.read_only
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

type ProfileRow = (String, String, String, bool);

fn read_profile_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ProfileRow> {
    Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
}

fn to_profile(
    (id, name, connection_string, read_only): ProfileRow,
) -> Result<StoredProfile, CoreError> {
    Ok(StoredProfile {
        id: ProfileId::parse(&id)?,
        name,
        connection_string,
        read_only,
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
