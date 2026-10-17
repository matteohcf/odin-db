//! Database and collection listing for the connection tree.

use bson::doc;
use mongodb::results::CollectionType;
use serde::Serialize;

use crate::CoreError;
use crate::connection::ConnectionHandle;
use crate::ejson::number_of;
use crate::query::Namespace;

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct DatabaseInfo {
    pub name: String,
    /// Bytes. `f64` because TypeScript numbers cannot hold every `u64`.
    pub size_on_disk: f64,
    pub empty: bool,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum CollectionKind {
    Collection,
    View,
    Timeseries,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct CollectionInfo {
    pub name: String,
    pub kind: CollectionKind,
}

pub async fn list_databases(handle: &ConnectionHandle) -> Result<Vec<DatabaseInfo>, CoreError> {
    // Users without the listDatabases privilege still see the databases they can access.
    let mut databases: Vec<DatabaseInfo> = handle
        .client
        .list_databases()
        .authorized_databases(true)
        .await?
        .into_iter()
        .map(|spec| DatabaseInfo {
            name: spec.name,
            #[allow(clippy::cast_precision_loss)]
            size_on_disk: spec.size_on_disk as f64,
            empty: spec.empty,
        })
        .collect();
    databases.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(databases)
}

pub async fn list_collections(
    handle: &ConnectionHandle,
    database: &str,
) -> Result<Vec<CollectionInfo>, CoreError> {
    let mut cursor = handle
        .client
        .database(database)
        .list_collections()
        .authorized_collections(true)
        .await?;
    let mut collections = Vec::new();
    while cursor.advance().await? {
        let spec = cursor.deserialize_current()?;
        let kind = match spec.collection_type {
            CollectionType::View => CollectionKind::View,
            CollectionType::Timeseries => CollectionKind::Timeseries,
            _ => CollectionKind::Collection,
        };
        collections.push(CollectionInfo {
            name: spec.name,
            kind,
        });
    }
    collections.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(collections)
}

/// Sizes in bytes; `f64` because TypeScript numbers cannot hold every `u64`.
#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct CollectionStats {
    pub documents: f64,
    pub size: f64,
    pub average_document_size: f64,
    pub storage_size: f64,
    pub indexes: f64,
    pub index_size: f64,
}

/// Storage statistics of a collection, summed over shards. Views have none.
pub async fn collection_stats(
    handle: &ConnectionHandle,
    namespace: &Namespace,
) -> Result<CollectionStats, CoreError> {
    let mut cursor = namespace
        .collection(handle)?
        .aggregate([doc! { "$collStats": { "storageStats": {} } }])
        .await?;
    let mut stats = CollectionStats::default();
    while cursor.advance().await? {
        let shard = cursor.deserialize_current()?;
        let Ok(storage) = shard.get_document("storageStats") else {
            continue;
        };
        let number = |key: &str| storage.get(key).map_or(0.0, number_of);
        stats.documents += number("count");
        stats.size += number("size");
        stats.storage_size += number("storageSize");
        stats.index_size += number("totalIndexSize");
        // Every shard has the same indexes.
        stats.indexes = stats.indexes.max(number("nindexes"));
    }
    if stats.documents > 0.0 {
        stats.average_document_size = stats.size / stats.documents;
    }
    Ok(stats)
}
