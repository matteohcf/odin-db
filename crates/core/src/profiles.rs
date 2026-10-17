//! Saved connection profiles (ADR-0008, ADR-0016). Passwords are split out of the
//! connection string and stored in the keyring; the database never holds a secret.

use std::fmt;

use mongodb::options::ConnectionString;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::CoreError;
use crate::secrets::{Secret, SecretStore};
use crate::storage::Storage;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(transparent)]
pub struct ProfileId(Uuid);

impl ProfileId {
    pub(crate) fn new() -> Self {
        Self(Uuid::now_v7())
    }

    pub(crate) fn parse(value: &str) -> Result<Self, CoreError> {
        Uuid::parse_str(value)
            .map(Self)
            .map_err(|error| CoreError::Storage(format!("corrupt profile id: {error}")))
    }
}

impl fmt::Display for ProfileId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ConnectionProfile {
    pub id: ProfileId,
    pub name: String,
    /// Never contains a password.
    pub connection_string: String,
    pub read_only: bool,
    pub has_password: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ProfileInput {
    pub name: String,
    /// May contain a password; it is moved to the keyring.
    pub connection_string: String,
    /// Takes precedence over a password embedded in the connection string.
    /// On update, `None` keeps the stored password.
    pub password: Option<Secret>,
    pub read_only: bool,
}

/// Validates a connection string and removes the password from it.
/// Returns the sanitized string and the decoded password, if any.
pub fn split_password(connection_string: &str) -> Result<(String, Option<Secret>), CoreError> {
    let trimmed = connection_string.trim();
    let parsed = ConnectionString::parse(trimmed)
        .map_err(|error| CoreError::Validation(format!("invalid connection string: {error}")))?;
    let password = parsed
        .credential
        .and_then(|credential| credential.password)
        .map(Secret::new);

    let Some(scheme_end) = trimmed.find("://").map(|i| i + 3) else {
        return Err(CoreError::Validation("missing scheme".into()));
    };
    let rest = &trimmed[scheme_end..];
    let authority_end = rest.find(['/', '?']).unwrap_or(rest.len());
    let authority = &rest[..authority_end];

    // The spec requires '@', ':' and '/' inside credentials to be percent-encoded,
    // so the last '@' ends the user info and the first ':' ends the username.
    let Some(at) = authority.rfind('@') else {
        return Ok((trimmed.to_owned(), password));
    };
    let user_info = &authority[..at];
    let username = user_info
        .split_once(':')
        .map_or(user_info, |(user, _)| user);
    let sanitized = format!(
        "{}{}{}{}",
        &trimmed[..scheme_end],
        username,
        &authority[at..],
        &rest[authority_end..]
    );
    Ok((sanitized, password))
}

fn validate_name(name: &str) -> Result<String, CoreError> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 100 {
        return Err(CoreError::Validation(
            "name must be between 1 and 100 characters".into(),
        ));
    }
    Ok(name.to_owned())
}

pub fn list(
    storage: &Storage,
    secrets: &dyn SecretStore,
) -> Result<Vec<ConnectionProfile>, CoreError> {
    storage
        .list_profiles()?
        .into_iter()
        .map(|row| with_password_flag(row, secrets))
        .collect()
}

pub fn get(
    storage: &Storage,
    secrets: &dyn SecretStore,
    id: ProfileId,
) -> Result<ConnectionProfile, CoreError> {
    with_password_flag(storage.get_profile(id)?, secrets)
}

pub fn create(
    storage: &Storage,
    secrets: &dyn SecretStore,
    input: ProfileInput,
) -> Result<ConnectionProfile, CoreError> {
    let name = validate_name(&input.name)?;
    let (connection_string, embedded) = split_password(&input.connection_string)?;
    let id = ProfileId::new();
    let row = StoredProfile {
        id,
        name,
        connection_string,
        read_only: input.read_only,
    };
    storage.insert_profile(&row)?;

    if let Some(password) = input.password.or(embedded) {
        // Roll back so a profile never exists without the password the user gave.
        if let Err(error) = secrets.set_password(id, &password) {
            let _ = storage.delete_profile(id);
            return Err(error);
        }
    }
    get(storage, secrets, id)
}

pub fn update(
    storage: &Storage,
    secrets: &dyn SecretStore,
    id: ProfileId,
    input: ProfileInput,
) -> Result<ConnectionProfile, CoreError> {
    let name = validate_name(&input.name)?;
    let (connection_string, embedded) = split_password(&input.connection_string)?;
    storage.update_profile(&StoredProfile {
        id,
        name,
        connection_string,
        read_only: input.read_only,
    })?;
    if let Some(password) = input.password.or(embedded) {
        secrets.set_password(id, &password)?;
    }
    get(storage, secrets, id)
}

pub fn delete(
    storage: &Storage,
    secrets: &dyn SecretStore,
    id: ProfileId,
) -> Result<(), CoreError> {
    secrets.delete_password(id)?;
    storage.delete_profile(id)
}

pub fn clear_password(secrets: &dyn SecretStore, id: ProfileId) -> Result<(), CoreError> {
    secrets.delete_password(id)
}

fn with_password_flag(
    row: StoredProfile,
    secrets: &dyn SecretStore,
) -> Result<ConnectionProfile, CoreError> {
    Ok(ConnectionProfile {
        has_password: secrets.password(row.id)?.is_some(),
        id: row.id,
        name: row.name,
        connection_string: row.connection_string,
        read_only: row.read_only,
    })
}

/// A profile as persisted in SQLite.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct StoredProfile {
    pub id: ProfileId,
    pub name: String,
    pub connection_string: String,
    pub read_only: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secrets::MemoryStore;

    #[test]
    fn split_password_strips_and_decodes_password() {
        let (sanitized, password) =
            split_password("mongodb://alice:p%40ss%3Aw0rd@db1:27017,db2/admin?replicaSet=rs0")
                .expect("valid");
        assert_eq!(
            sanitized,
            "mongodb://alice@db1:27017,db2/admin?replicaSet=rs0"
        );
        assert_eq!(password.as_ref().map(Secret::expose), Some("p@ss:w0rd"));
    }

    #[test]
    fn split_password_handles_srv_and_missing_credentials() {
        let (sanitized, password) =
            split_password("  mongodb+srv://bob:secret@cluster0.example.net/?retryWrites=true ")
                .expect("valid");
        assert_eq!(
            sanitized,
            "mongodb+srv://bob@cluster0.example.net/?retryWrites=true"
        );
        assert_eq!(password.as_ref().map(Secret::expose), Some("secret"));

        let (sanitized, password) = split_password("mongodb://localhost").expect("valid");
        assert_eq!(sanitized, "mongodb://localhost");
        assert!(password.is_none());

        let (sanitized, password) = split_password("mongodb://carol@localhost").expect("valid");
        assert_eq!(sanitized, "mongodb://carol@localhost");
        assert!(password.is_none());
    }

    #[test]
    fn split_password_rejects_invalid_strings() {
        assert!(matches!(
            split_password("http://localhost"),
            Err(CoreError::Validation(_))
        ));
    }

    #[test]
    fn create_moves_password_to_secret_store_and_delete_removes_it() {
        let storage = Storage::open_in_memory().expect("storage");
        let secrets = MemoryStore::default();
        let profile = create(
            &storage,
            &secrets,
            ProfileInput {
                name: " Local ".into(),
                connection_string: "mongodb://admin:pw@localhost".into(),
                password: None,
                read_only: true,
            },
        )
        .expect("created");

        assert_eq!(profile.name, "Local");
        assert_eq!(profile.connection_string, "mongodb://admin@localhost");
        assert!(profile.has_password && profile.read_only);
        assert_eq!(
            secrets
                .password(profile.id)
                .expect("read")
                .as_ref()
                .map(Secret::expose),
            Some("pw")
        );
        assert_eq!(
            list(&storage, &secrets).expect("list"),
            vec![profile.clone()]
        );

        delete(&storage, &secrets, profile.id).expect("deleted");
        assert!(secrets.password(profile.id).expect("read").is_none());
        assert_eq!(list(&storage, &secrets).expect("list"), Vec::new());
    }

    #[test]
    fn update_keeps_password_unless_a_new_one_is_given() {
        let storage = Storage::open_in_memory().expect("storage");
        let secrets = MemoryStore::default();
        let input = |password: Option<&str>| ProfileInput {
            name: "Prod".into(),
            connection_string: "mongodb://admin@localhost".into(),
            password: password.map(Secret::new),
            read_only: false,
        };
        let profile = create(&storage, &secrets, input(Some("first"))).expect("created");

        update(&storage, &secrets, profile.id, input(None)).expect("updated");
        assert_eq!(
            secrets
                .password(profile.id)
                .expect("read")
                .as_ref()
                .map(Secret::expose),
            Some("first")
        );

        update(&storage, &secrets, profile.id, input(Some("second"))).expect("updated");
        assert_eq!(
            secrets
                .password(profile.id)
                .expect("read")
                .as_ref()
                .map(Secret::expose),
            Some("second")
        );
    }
}
