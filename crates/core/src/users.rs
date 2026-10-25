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

/// What a privilege applies to.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Resource {
    /// A collection, every collection of `db` when `collection` is empty, or of
    /// every database when both are.
    Namespace {
        db: String,
        collection: String,
    },
    Cluster,
    /// Every resource; only built-in roles have it, but a custom role can inherit it.
    Any,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct Privilege {
    pub resource: Resource,
    pub actions: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct CustomRole {
    pub role: String,
    pub db: String,
    pub privileges: Vec<Privilege>,
    /// Roles it inherits privileges from.
    pub roles: Vec<RoleRef>,
}

/// The custom roles of every database, sorted by database then name.
///
/// `rolesInfo` reads one database at a time. Databases holding no data are not
/// listed, so the databases named in `admin.system.roles` are added when the
/// user may read it.
pub async fn list_custom_roles(handle: &ConnectionHandle) -> Result<Vec<CustomRole>, CoreError> {
    let mut names: Vec<String> = crate::browse::list_databases(handle)
        .await?
        .into_iter()
        .map(|database| database.name)
        .collect();
    names.push("admin".into());
    if let Ok(defined) = handle
        .client
        .database("admin")
        .collection::<Document>("system.roles")
        .distinct("db", doc! {})
        .await
    {
        names.extend(defined.iter().filter_map(Bson::as_str).map(str::to_owned));
    }
    names.sort();
    names.dedup();
    let mut roles = Vec::new();
    for name in names {
        let reply = handle
            .client
            .database(&name)
            .run_command(doc! { "rolesInfo": 1, "showPrivileges": true })
            .await?;
        if let Ok(found) = reply.get_array("roles") {
            roles.extend(
                found
                    .iter()
                    .filter_map(Bson::as_document)
                    .map(to_custom_role),
            );
        }
    }
    roles.sort_by(|a, b| (&a.db, &a.role).cmp(&(&b.db, &b.role)));
    Ok(roles)
}

fn to_custom_role(role: &Document) -> CustomRole {
    CustomRole {
        role: role.get_str("role").unwrap_or_default().to_owned(),
        db: role.get_str("db").unwrap_or_default().to_owned(),
        privileges: role
            .get_array("privileges")
            .map(|items| {
                items
                    .iter()
                    .filter_map(Bson::as_document)
                    .map(to_privilege)
                    .collect()
            })
            .unwrap_or_default(),
        roles: roles_of(role),
    }
}

fn to_privilege(privilege: &Document) -> Privilege {
    let resource = privilege.get_document("resource").ok();
    let resource = match resource {
        Some(r) if r.get_bool("cluster").unwrap_or(false) => Resource::Cluster,
        Some(r) if r.get_bool("anyResource").unwrap_or(false) => Resource::Any,
        r => Resource::Namespace {
            db: r
                .and_then(|r| r.get_str("db").ok())
                .unwrap_or_default()
                .to_owned(),
            collection: r
                .and_then(|r| r.get_str("collection").ok())
                .unwrap_or_default()
                .to_owned(),
        },
    };
    Privilege {
        resource,
        actions: privilege
            .get_array("actions")
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

fn privileges_bson(privileges: &[Privilege]) -> Result<Vec<Bson>, CoreError> {
    privileges
        .iter()
        .map(|privilege| {
            let resource = match &privilege.resource {
                Resource::Namespace { db, collection } => {
                    doc! { "db": db.trim(), "collection": collection.trim() }
                }
                Resource::Cluster => doc! { "cluster": true },
                Resource::Any => doc! { "anyResource": true },
            };
            let actions: Vec<&str> = privilege
                .actions
                .iter()
                .map(|action| action.trim())
                .filter(|action| !action.is_empty())
                .collect();
            if actions.is_empty() {
                return Err(CoreError::Validation(
                    "every privilege needs at least one action".into(),
                ));
            }
            Ok(Bson::Document(
                doc! { "resource": resource, "actions": actions },
            ))
        })
        .collect()
}

fn validate_role_name(name: &str) -> Result<&str, CoreError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(CoreError::Validation("enter a role name".into()));
    }
    Ok(name)
}

/// Creates a role on `database` with these privileges and inherited roles.
pub async fn create_role(
    handle: &ConnectionHandle,
    database: &str,
    name: &str,
    privileges: &[Privilege],
    roles: &[RoleRef],
) -> Result<(), CoreError> {
    handle.ensure_writable()?;
    let command = doc! {
        "createRole": validate_role_name(name)?,
        "privileges": privileges_bson(privileges)?,
        "roles": roles_bson(roles),
    };
    handle
        .client
        .database(database)
        .run_command(command)
        .await?;
    Ok(())
}

/// Replaces the role's privileges and inherited roles.
pub async fn update_role(
    handle: &ConnectionHandle,
    database: &str,
    name: &str,
    privileges: &[Privilege],
    roles: &[RoleRef],
) -> Result<(), CoreError> {
    handle.ensure_writable()?;
    let command = doc! {
        "updateRole": validate_role_name(name)?,
        "privileges": privileges_bson(privileges)?,
        "roles": roles_bson(roles),
    };
    handle
        .client
        .database(database)
        .run_command(command)
        .await?;
    Ok(())
}

/// Drops the role; users that had it lose its privileges.
pub async fn drop_role(
    handle: &ConnectionHandle,
    database: &str,
    name: &str,
) -> Result<(), CoreError> {
    handle.ensure_writable()?;
    handle
        .client
        .database(database)
        .run_command(doc! { "dropRole": validate_role_name(name)? })
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

    #[test]
    fn custom_roles_read_privileges_and_resources() {
        let role = to_custom_role(&doc! {
            "role": "reportWriter", "db": "admin",
            "privileges": [
                { "resource": { "db": "shop", "collection": "reports" }, "actions": ["find", "insert"] },
                { "resource": { "db": "shop", "collection": "" }, "actions": ["listCollections"] },
                { "resource": { "cluster": true }, "actions": ["serverStatus"] },
                { "resource": { "anyResource": true }, "actions": ["anyAction"] },
            ],
            "roles": [{ "role": "read", "db": "analytics" }],
        });
        assert_eq!(role.privileges.len(), 4);
        assert_eq!(
            role.privileges[0],
            Privilege {
                resource: Resource::Namespace {
                    db: "shop".into(),
                    collection: "reports".into()
                },
                actions: vec!["find".into(), "insert".into()],
            }
        );
        assert_eq!(role.privileges[2].resource, Resource::Cluster);
        assert_eq!(role.privileges[3].resource, Resource::Any);
        assert_eq!(role.roles[0].role, "read");

        // Written back as the server reads it; blank actions are dropped.
        let mut privileges = role.privileges.clone();
        privileges[0].actions.push("  ".into());
        let written = privileges_bson(&privileges).expect("valid");
        assert_eq!(
            written[0],
            Bson::Document(doc! {
                "resource": { "db": "shop", "collection": "reports" },
                "actions": ["find", "insert"],
            })
        );
        assert_eq!(
            written[2],
            Bson::Document(doc! { "resource": { "cluster": true }, "actions": ["serverStatus"] })
        );
        privileges[1].actions = vec![" ".into()];
        assert!(
            privileges_bson(&privileges).is_err(),
            "a privilege without actions"
        );
        assert!(validate_role_name(" ").is_err());
    }
}
