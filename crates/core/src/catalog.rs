//! Creating, renaming and dropping databases and collections. Every operation
//! checks the profile's read-only flag first (ADR-0017).

use bson::doc;

use crate::CoreError;
use crate::connection::ConnectionHandle;
use crate::query::Namespace;

/// MongoDB's limits for database names, checked before the round trip so the
/// UI can explain the problem precisely.
pub fn validate_database_name(name: &str) -> Result<(), CoreError> {
    if name.is_empty() {
        return Err(CoreError::Validation("enter a database name".into()));
    }
    if name.len() >= 64 {
        return Err(CoreError::Validation(
            "database names must be shorter than 64 bytes".into(),
        ));
    }
    if let Some(bad) = name.chars().find(|c| {
        matches!(
            c,
            '/' | '\\' | '.' | ' ' | '"' | '$' | '*' | '<' | '>' | ':' | '|' | '?' | '\0'
        )
    }) {
        return Err(CoreError::Validation(format!(
            "database names cannot contain {}",
            describe(bad)
        )));
    }
    Ok(())
}

pub fn validate_collection_name(name: &str) -> Result<(), CoreError> {
    if name.is_empty() {
        return Err(CoreError::Validation("enter a collection name".into()));
    }
    if name.starts_with("system.") {
        return Err(CoreError::Validation(
            "names starting with system. are reserved".into(),
        ));
    }
    if let Some(bad) = name.chars().find(|c| matches!(c, '$' | '\0')) {
        return Err(CoreError::Validation(format!(
            "collection names cannot contain {}",
            describe(bad)
        )));
    }
    Ok(())
}

fn describe(c: char) -> String {
    match c {
        ' ' => "spaces".into(),
        '\0' => "null characters".into(),
        c => format!("\"{c}\""),
    }
}

/// Creates an empty collection. A new database comes into existence with its
/// first collection.
pub async fn create_collection(
    handle: &ConnectionHandle,
    namespace: &Namespace,
) -> Result<(), CoreError> {
    handle.ensure_writable()?;
    validate_database_name(&namespace.database)?;
    validate_collection_name(&namespace.collection)?;
    let database = handle.client.database(&namespace.database);
    // Since MongoDB 7.0 creating an existing collection succeeds silently; the user
    // should know the name is taken.
    let existing = database
        .list_collection_names()
        .filter(doc! { "name": &namespace.collection })
        .await?;
    if !existing.is_empty() {
        return Err(CoreError::Validation(format!(
            "{} already exists in {}",
            namespace.collection, namespace.database
        )));
    }
    database.create_collection(&namespace.collection).await?;
    Ok(())
}

/// Renames within the same database. Fails if the target exists: nothing is
/// overwritten.
pub async fn rename_collection(
    handle: &ConnectionHandle,
    namespace: &Namespace,
    new_name: &str,
) -> Result<(), CoreError> {
    handle.ensure_writable()?;
    validate_collection_name(new_name)?;
    let from = format!("{}.{}", namespace.database, namespace.collection);
    let to = format!("{}.{new_name}", namespace.database);
    handle
        .client
        .database("admin")
        .run_command(doc! { "renameCollection": from, "to": to, "dropTarget": false })
        .await?;
    Ok(())
}

/// Drops a collection or view, with its documents and indexes.
pub async fn drop_collection(
    handle: &ConnectionHandle,
    namespace: &Namespace,
) -> Result<(), CoreError> {
    handle.ensure_writable()?;
    namespace.collection(handle)?.drop().await?;
    Ok(())
}

pub async fn drop_database(handle: &ConnectionHandle, database: &str) -> Result<(), CoreError> {
    handle.ensure_writable()?;
    validate_database_name(database)?;
    if matches!(database, "admin" | "local" | "config") {
        return Err(CoreError::Validation(format!(
            "{database} is a system database and cannot be dropped here"
        )));
    }
    handle.client.database(database).drop().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn database_names_follow_mongodb_rules() {
        assert!(validate_database_name("shop_2026").is_ok());
        assert!(validate_database_name("").is_err());
        assert!(validate_database_name("my db").is_err());
        assert!(validate_database_name("a.b").is_err());
        assert!(validate_database_name(&"x".repeat(64)).is_err());
    }

    #[test]
    fn collection_names_follow_mongodb_rules() {
        assert!(validate_collection_name("orders.archive").is_ok());
        assert!(validate_collection_name("").is_err());
        assert!(validate_collection_name("system.views").is_err());
        assert!(validate_collection_name("a$b").is_err());
    }
}
