//! Creating, renaming and dropping databases and collections. Every operation
//! checks the profile's read-only flag first (ADR-0017).

use bson::{Bson, Document, doc};
use serde::Deserialize;

use crate::CoreError;
use crate::connection::ConnectionHandle;
use crate::ejson::EJsonDocument;
use crate::query::Namespace;

/// What kind of collection to create (ADR-0053).
#[derive(Debug, Clone, Default, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum NewCollectionKind {
    #[default]
    Standard,
    /// Fixed size; the oldest documents make room for new ones.
    Capped {
        size_bytes: f64,
        #[serde(default)]
        max_documents: Option<u32>,
    },
    /// Measurements over time, stored by time and meta field.
    TimeSeries {
        time_field: String,
        #[serde(default)]
        meta_field: Option<String>,
        /// `seconds`, `minutes` or `hours`.
        #[serde(default)]
        granularity: Option<String>,
        #[serde(default)]
        expire_after_seconds: Option<u32>,
    },
    /// Documents stored in `_id` order.
    Clustered {
        #[serde(default)]
        expire_after_seconds: Option<u32>,
    },
    /// A read-only view: an aggregation pipeline over another collection or view.
    View {
        source: String,
        pipeline: Vec<EJsonDocument>,
    },
}

#[derive(Debug, Clone, Default, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct CollectionOptions {
    #[serde(default)]
    pub kind: NewCollectionKind,
    /// The default collation of its queries and indexes.
    #[serde(default)]
    pub collation: Option<EJsonDocument>,
}

impl CollectionOptions {
    /// The `create` command for this collection.
    fn command(&self, name: &str) -> Result<Document, CoreError> {
        let mut command = doc! { "create": name };
        match &self.kind {
            NewCollectionKind::Standard => {}
            NewCollectionKind::Capped {
                size_bytes,
                max_documents,
            } => {
                if !size_bytes.is_finite() || *size_bytes < 1.0 {
                    return Err(CoreError::Validation(
                        "a capped collection needs a size".into(),
                    ));
                }
                command.insert("capped", true);
                #[allow(clippy::cast_possible_truncation)]
                command.insert("size", size_bytes.round() as i64);
                if let Some(max) = max_documents.filter(|max| *max > 0) {
                    command.insert("max", i64::from(max));
                }
            }
            NewCollectionKind::TimeSeries {
                time_field,
                meta_field,
                granularity,
                expire_after_seconds,
            } => {
                if time_field.trim().is_empty() {
                    return Err(CoreError::Validation(
                        "a time series collection needs a time field".into(),
                    ));
                }
                let mut timeseries = doc! { "timeField": time_field.trim() };
                if let Some(meta) = meta_field
                    .as_deref()
                    .map(str::trim)
                    .filter(|m| !m.is_empty())
                {
                    timeseries.insert("metaField", meta);
                }
                if let Some(granularity) = granularity {
                    timeseries.insert("granularity", granularity.as_str());
                }
                command.insert("timeseries", timeseries);
                if let Some(seconds) = expire_after_seconds {
                    command.insert("expireAfterSeconds", i64::from(*seconds));
                }
            }
            NewCollectionKind::Clustered {
                expire_after_seconds,
            } => {
                command.insert(
                    "clusteredIndex",
                    doc! { "key": { "_id": 1 }, "unique": true },
                );
                if let Some(seconds) = expire_after_seconds {
                    command.insert("expireAfterSeconds", i64::from(*seconds));
                }
            }
            NewCollectionKind::View { source, pipeline } => {
                validate_collection_name(source.trim())?;
                command.insert("viewOn", source.trim());
                let stages = pipeline
                    .iter()
                    .cloned()
                    .map(|stage| Document::try_from(stage).map(Bson::Document))
                    .collect::<Result<Vec<_>, _>>()?;
                command.insert("pipeline", stages);
            }
        }
        if let Some(collation) = self.collation.clone() {
            command.insert("collation", Document::try_from(collation)?);
        }
        Ok(command)
    }
}

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

/// Creates an empty collection, or a view. A new database comes into existence
/// with its first collection.
pub async fn create_collection(
    handle: &ConnectionHandle,
    namespace: &Namespace,
    options: &CollectionOptions,
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
    database
        .run_command(options.command(&namespace.collection)?)
        .await?;
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

    #[test]
    fn options_become_create_command_fields() {
        let options = |kind| CollectionOptions {
            kind,
            collation: None,
        };
        let capped = options(NewCollectionKind::Capped {
            size_bytes: 1024.0,
            max_documents: Some(0),
        });
        assert_eq!(
            capped.command("logs").expect("valid"),
            doc! { "create": "logs", "capped": true, "size": 1024_i64 }
        );
        let series = options(NewCollectionKind::TimeSeries {
            time_field: "at".into(),
            meta_field: Some(" ".into()),
            granularity: None,
            expire_after_seconds: Some(60),
        });
        assert_eq!(
            series.command("m").expect("valid"),
            doc! { "create": "m", "timeseries": { "timeField": "at" }, "expireAfterSeconds": 60_i64 }
        );
        let zero = options(NewCollectionKind::Capped {
            size_bytes: 0.0,
            max_documents: None,
        });
        assert!(zero.command("logs").is_err());
        let untimed = options(NewCollectionKind::TimeSeries {
            time_field: " ".into(),
            meta_field: None,
            granularity: None,
            expire_after_seconds: None,
        });
        assert!(untimed.command("m").is_err());
        let view = options(NewCollectionKind::View {
            source: "system.views".into(),
            pipeline: vec![],
        });
        assert!(view.command("v").is_err());
    }
}
