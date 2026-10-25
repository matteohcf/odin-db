//! Database users and their roles.

use bson::{Bson, Document, doc};
use serde::{Deserialize, Serialize};

use crate::CoreError;
use crate::connection::ConnectionHandle;
use crate::secrets::Secret;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct RoleRef {
    pub role: String,
    /// The database the role applies to.
    pub db: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct UserInfo {
    pub user: String,
    /// The authentication database the user belongs to.
    pub db: String,
    pub roles: Vec<RoleRef>,
    pub mechanisms: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct RoleInfo {
    pub role: String,
    pub db: String,
    pub built_in: bool,
}

/// Every user of every database, sorted by database then name.
pub async fn list_users(handle: &ConnectionHandle) -> Result<Vec<UserInfo>, CoreError> {
    let reply = handle
        .client
        .database("admin")
        .run_command(doc! { "usersInfo": { "forAllDBs": true } })
        .await?;
    let mut users: Vec<UserInfo> = reply
        .get_array("users")
        .map(|users| {
            users
                .iter()
                .filter_map(Bson::as_document)
                .map(to_user)
                .collect()
        })
        .unwrap_or_default();
    users.sort_by(|a, b| (&a.db, &a.user).cmp(&(&b.db, &b.user)));
    Ok(users)
}

fn to_user(user: &Document) -> UserInfo {
    UserInfo {
        user: user.get_str("user").unwrap_or_default().to_owned(),
        db: user.get_str("db").unwrap_or_default().to_owned(),
        roles: roles_of(user),
        mechanisms: user
            .get_array("mechanisms")
            .map(|items| {
                items
                    .iter()
                    .filter_map(Bson::as_str)
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default(),
    }
}

fn roles_of(document: &Document) -> Vec<RoleRef> {
    document
        .get_array("roles")
        .map(|roles| {
            roles
                .iter()
                .filter_map(Bson::as_document)
                .map(|role| RoleRef {
                    role: role.get_str("role").unwrap_or_default().to_owned(),
                    db: role.get_str("db").unwrap_or_default().to_owned(),
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Roles that can be granted on `database`: built-in ones and custom ones.
pub async fn list_roles(
    handle: &ConnectionHandle,
    database: &str,
) -> Result<Vec<RoleInfo>, CoreError> {
    let reply = handle
        .client
        .database(database)
        .run_command(doc! { "rolesInfo": 1, "showBuiltinRoles": true })
        .await?;
    let mut roles: Vec<RoleInfo> = reply
        .get_array("roles")
        .map(|roles| {
            roles
                .iter()
                .filter_map(Bson::as_document)
                .map(|role| RoleInfo {
                    role: role.get_str("role").unwrap_or_default().to_owned(),
                    db: role.get_str("db").unwrap_or_default().to_owned(),
                    built_in: role.get_bool("isBuiltin").unwrap_or(false),
                })
                .collect()
        })
        .unwrap_or_default();
    roles.sort_by(|a, b| (!a.built_in, &a.role).cmp(&(!b.built_in, &b.role)));
    Ok(roles)
}

fn validate_name(name: &str) -> Result<&str, CoreError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(CoreError::Validation("enter a user name".into()));
    }
    Ok(name)
}

fn roles_bson(roles: &[RoleRef]) -> Vec<Bson> {
    roles
        .iter()
        .map(|role| Bson::Document(doc! { "role": &role.role, "db": &role.db }))
        .collect()
}

pub async fn create_user(
    handle: &ConnectionHandle,
    database: &str,
    name: &str,
    password: &Secret,
    roles: &[RoleRef],
) -> Result<(), CoreError> {
    handle.ensure_writable()?;
    let name = validate_name(name)?;
    if password.expose().is_empty() {
        return Err(CoreError::Validation("enter a password".into()));
    }
    handle
        .client
        .database(database)
        .run_command(
            doc! { "createUser": name, "pwd": password.expose(), "roles": roles_bson(roles) },
        )
        .await?;
    Ok(())
}

/// Replaces the user's roles with `roles`.
pub async fn set_roles(
    handle: &ConnectionHandle,
    database: &str,
    name: &str,
    roles: &[RoleRef],
) -> Result<(), CoreError> {
    handle.ensure_writable()?;
    handle
        .client
        .database(database)
        .run_command(doc! { "updateUser": validate_name(name)?, "roles": roles_bson(roles) })
        .await?;
    Ok(())
}

pub async fn change_password(
    handle: &ConnectionHandle,
    database: &str,
    name: &str,
    password: &Secret,
) -> Result<(), CoreError> {
    handle.ensure_writable()?;
    if password.expose().is_empty() {
        return Err(CoreError::Validation("enter a password".into()));
    }
    handle
        .client
        .database(database)
        .run_command(doc! { "updateUser": validate_name(name)?, "pwd": password.expose() })
        .await?;
    Ok(())
}

pub async fn drop_user(
    handle: &ConnectionHandle,
    database: &str,
    name: &str,
) -> Result<(), CoreError> {
    handle.ensure_writable()?;
    handle
        .client
        .database(database)
        .run_command(doc! { "dropUser": validate_name(name)? })
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn users_and_roles_read_from_users_info() {
        let user = to_user(&doc! {
            "user": "shop-api", "db": "shop",
            "roles": [{ "role": "readWrite", "db": "shop" }, { "bad": true }],
            "mechanisms": ["SCRAM-SHA-256", 1],
        });
        assert_eq!((user.user.as_str(), user.db.as_str()), ("shop-api", "shop"));
        assert_eq!(
            user.roles.len(),
            2,
            "a malformed role reads as empty, not dropped silently"
        );
        assert_eq!(user.roles[0].role, "readWrite");
        assert_eq!(user.mechanisms, ["SCRAM-SHA-256"]);
        assert_eq!(
            roles_bson(&user.roles[..1]),
            [Bson::Document(doc! { "role": "readWrite", "db": "shop" })]
        );
        assert_eq!(validate_name("  ada ").ok(), Some("ada"));
        assert!(validate_name("   ").is_err());
    }
}
