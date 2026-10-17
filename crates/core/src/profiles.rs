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

/// A label color, like Compass's, so production never looks like development.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum ProfileColor {
    Red,
    Orange,
    Yellow,
    Green,
    Teal,
    Blue,
    Purple,
    Pink,
    Gray,
}

impl ProfileColor {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Red => "red",
            Self::Orange => "orange",
            Self::Yellow => "yellow",
            Self::Green => "green",
            Self::Teal => "teal",
            Self::Blue => "blue",
            Self::Purple => "purple",
            Self::Pink => "pink",
            Self::Gray => "gray",
        }
    }

    /// Unknown values (from a newer version) read as no color.
    pub(crate) fn parse(value: &str) -> Option<Self> {
        [
            Self::Red,
            Self::Orange,
            Self::Yellow,
            Self::Green,
            Self::Teal,
            Self::Blue,
            Self::Purple,
            Self::Pink,
            Self::Gray,
        ]
        .into_iter()
        .find(|color| color.as_str() == value)
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
    pub color: Option<ProfileColor>,
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
    #[serde(default)]
    pub color: Option<ProfileColor>,
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
        color: input.color,
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
        color: input.color,
    })?;
    if let Some(password) = input.password.or(embedded) {
        secrets.set_password(id, &password)?;
    }
    get(storage, secrets, id)
}

/// A copy of the profile under a new name, password included.
pub fn duplicate(
    storage: &Storage,
    secrets: &dyn SecretStore,
    id: ProfileId,
    name: &str,
) -> Result<ConnectionProfile, CoreError> {
    let source = storage.get_profile(id)?;
    create(
        storage,
        secrets,
        ProfileInput {
            name: name.to_owned(),
            connection_string: source.connection_string,
            password: secrets.password(id)?,
            read_only: source.read_only,
            color: source.color,
        },
    )
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SharedFile {
    format: String,
    version: u32,
    connections: Vec<SharedConnection>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SharedConnection {
    name: String,
    connection_string: String,
    #[serde(default)]
    read_only: bool,
    #[serde(default)]
    color: Option<ProfileColor>,
}

const SHARED_FORMAT: &str = "odin-db.connections";

/// The profiles as a JSON file to share. Passwords never leave the keychain.
pub fn export_profiles(storage: &Storage, ids: &[ProfileId]) -> Result<String, CoreError> {
    let connections = storage
        .list_profiles()?
        .into_iter()
        .filter(|row| ids.is_empty() || ids.contains(&row.id))
        .map(|row| SharedConnection {
            name: row.name,
            connection_string: row.connection_string,
            read_only: row.read_only,
            color: row.color,
        })
        .collect();
    serde_json::to_string_pretty(&SharedFile {
        format: SHARED_FORMAT.into(),
        version: 1,
        connections,
    })
    .map_err(|error| CoreError::Internal(error.to_string()))
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ImportedProfiles {
    pub created: Vec<ConnectionProfile>,
    /// Entries identical to an existing profile (same name and connection string).
    pub skipped: f64,
}

/// Imports a file exported by odin-db, or by MongoDB Compass (connections
/// exported without passwords). Passwords in connection strings go to the keychain.
pub fn import_profiles(
    storage: &Storage,
    secrets: &dyn SecretStore,
    json: &str,
) -> Result<ImportedProfiles, CoreError> {
    let entries = parse_shared(json)?;
    let existing = storage.list_profiles()?;
    let mut created = Vec::new();
    let mut skipped = 0.0;
    for entry in entries {
        let (sanitized, _) = split_password(&entry.connection_string)?;
        if existing
            .iter()
            .any(|row| row.name == entry.name.trim() && row.connection_string == sanitized)
        {
            skipped += 1.0;
            continue;
        }
        created.push(create(
            storage,
            secrets,
            ProfileInput {
                name: entry.name,
                connection_string: entry.connection_string,
                password: None,
                read_only: entry.read_only,
                color: entry.color,
            },
        )?);
    }
    Ok(ImportedProfiles { created, skipped })
}

fn parse_shared(json: &str) -> Result<Vec<SharedConnection>, CoreError> {
    let invalid = |reason: &str| CoreError::Validation(format!("not a connections file: {reason}"));
    let value: serde_json::Value =
        serde_json::from_str(json).map_err(|e| invalid(&e.to_string()))?;
    if value.get("format").and_then(serde_json::Value::as_str) == Some(SHARED_FORMAT) {
        let file: SharedFile =
            serde_json::from_value(value).map_err(|e| invalid(&e.to_string()))?;
        return Ok(file.connections);
    }
    // Compass: { type: "Compass Connections", connections: [{ connectionOptions, favorite }] }.
    if value.get("type").and_then(serde_json::Value::as_str) == Some("Compass Connections") {
        let connections = value
            .get("connections")
            .and_then(serde_json::Value::as_array)
            .ok_or_else(|| invalid("no connections"))?;
        return connections
            .iter()
            .map(|connection| {
                let uri = connection
                    .pointer("/connectionOptions/connectionString")
                    .and_then(serde_json::Value::as_str)
                    .ok_or_else(|| invalid("a connection has no connection string"))?;
                let name = connection
                    .pointer("/favorite/name")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or(uri);
                Ok(SharedConnection {
                    name: name.to_owned(),
                    connection_string: uri.to_owned(),
                    read_only: false,
                    color: None,
                })
            })
            .collect();
    }
    Err(invalid("unknown format"))
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
        color: row.color,
    })
}

/// A profile as persisted in SQLite.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct StoredProfile {
    pub id: ProfileId,
    pub name: String,
    pub connection_string: String,
    pub read_only: bool,
    pub color: Option<ProfileColor>,
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
    fn exports_and_imports_profiles_without_passwords() {
        let storage = Storage::open_in_memory().expect("storage");
        let secrets = MemoryStore::default();
        let input = |name: &str, uri: &str| ProfileInput {
            name: name.into(),
            connection_string: uri.into(),
            password: None,
            read_only: true,
            color: Some(ProfileColor::Teal),
        };
        create(
            &storage,
            &secrets,
            input("Prod", "mongodb://admin:pw@prod.example.com"),
        )
        .expect("prod");
        create(&storage, &secrets, input("Dev", "mongodb://localhost")).expect("dev");
        let json = export_profiles(&storage, &[]).expect("export");
        assert!(!json.contains("pw"), "no password in {json}");

        let other = Storage::open_in_memory().expect("storage");
        let imported = import_profiles(&other, &secrets, &json).expect("import");
        assert_eq!(imported.created.len(), 2);
        let prod = imported
            .created
            .iter()
            .find(|p| p.name == "Prod")
            .expect("prod");
        assert_eq!(prod.connection_string, "mongodb://admin@prod.example.com");
        assert!(prod.read_only && prod.color == Some(ProfileColor::Teal));
        // Importing the same file again creates nothing.
        let again = import_profiles(&other, &secrets, &json).expect("again");
        assert_eq!((again.created.len(), again.skipped), (0, 2.0));
    }

    #[test]
    fn imports_compass_exports_and_rejects_other_files() {
        let storage = Storage::open_in_memory().expect("storage");
        let secrets = MemoryStore::default();
        let compass = r#"{"type":"Compass Connections","version":{"$numberInt":"1"},"connections":[
            {"id":"1","connectionOptions":{"connectionString":"mongodb://localhost:27017"},"favorite":{"name":"Local"}},
            {"id":"2","connectionOptions":{"connectionString":"mongodb+srv://cluster0.example.net"}}]}"#;
        let imported = import_profiles(&storage, &secrets, compass).expect("import");
        let names: Vec<_> = imported.created.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(names, ["Local", "mongodb+srv://cluster0.example.net"]);
        assert!(matches!(
            import_profiles(&storage, &secrets, r#"{"hello":1}"#),
            Err(CoreError::Validation(_))
        ));
    }

    #[test]
    fn duplicates_keep_everything_but_the_name() {
        let storage = Storage::open_in_memory().expect("storage");
        let secrets = MemoryStore::default();
        let source = create(
            &storage,
            &secrets,
            ProfileInput {
                name: "Prod".into(),
                connection_string: "mongodb://admin:pw@db.example.com".into(),
                password: None,
                read_only: true,
                color: Some(ProfileColor::Red),
            },
        )
        .expect("created");
        let copy = duplicate(&storage, &secrets, source.id, "Prod (copy)").expect("duplicated");
        assert_ne!(copy.id, source.id);
        assert_eq!(copy.name, "Prod (copy)");
        assert_eq!(copy.connection_string, source.connection_string);
        assert!(copy.read_only && copy.has_password);
        assert_eq!(copy.color, Some(ProfileColor::Red));
        assert_eq!(
            secrets
                .password(copy.id)
                .expect("read")
                .as_ref()
                .map(Secret::expose),
            Some("pw")
        );
    }

    #[test]
    fn colors_are_stored_changed_and_cleared() {
        let storage = Storage::open_in_memory().expect("storage");
        let secrets = MemoryStore::default();
        let input = |color| ProfileInput {
            name: "Prod".into(),
            connection_string: "mongodb://localhost".into(),
            password: None,
            read_only: false,
            color,
        };
        let profile = create(&storage, &secrets, input(Some(ProfileColor::Red))).expect("created");
        assert_eq!(profile.color, Some(ProfileColor::Red));
        let updated = update(
            &storage,
            &secrets,
            profile.id,
            input(Some(ProfileColor::Teal)),
        )
        .expect("updated");
        assert_eq!(updated.color, Some(ProfileColor::Teal));
        let cleared = update(&storage, &secrets, profile.id, input(None)).expect("cleared");
        assert_eq!(cleared.color, None);
        assert_eq!(ProfileColor::parse("ultraviolet"), None);
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
                color: None,
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
            color: None,
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
