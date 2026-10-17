//! Index management. Specs are read raw from `listIndexes` so no option is lost.

use std::collections::HashMap;
use std::time::Duration;

use bson::{Bson, Document, doc};
use mongodb::IndexModel;
use mongodb::options::IndexOptions;
use serde::{Deserialize, Serialize};

use crate::CoreError;
use crate::connection::ConnectionHandle;
use crate::ejson::EJsonDocument;
use crate::query::Namespace;

const ID_INDEX: &str = "_id_";

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct IndexInfo {
    pub name: String,
    pub keys: EJsonDocument,
    pub unique: bool,
    pub sparse: bool,
    pub hidden: bool,
    pub expire_after_seconds: Option<f64>,
    pub partial_filter: Option<EJsonDocument>,
    /// The complete spec as returned by the server.
    pub definition: EJsonDocument,
    /// Bytes on disk, when the server reports it.
    pub size: Option<f64>,
    /// Operations that used the index since `usage_since`, when reported.
    pub usage_count: Option<f64>,
    pub usage_since: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct CreateIndexRequest {
    pub keys: EJsonDocument,
    pub name: Option<String>,
    pub unique: bool,
    pub sparse: bool,
    pub hidden: bool,
    pub expire_after_seconds: Option<u32>,
    pub partial_filter: Option<EJsonDocument>,
}

pub async fn list(
    handle: &ConnectionHandle,
    namespace: &Namespace,
) -> Result<Vec<IndexInfo>, CoreError> {
    let collection = namespace.collection(handle)?;
    let reply = handle
        .client
        .database(&namespace.database)
        .run_command(doc! { "listIndexes": &namespace.collection })
        .await?;
    let specs = reply
        .get_document("cursor")
        .and_then(|cursor| cursor.get_array("firstBatch"))
        .map_err(|error| CoreError::Database(format!("unexpected listIndexes reply: {error}")))?;

    // Sizes and usage are best effort: views and restricted users don't report them.
    let sizes = index_sizes(&collection).await.unwrap_or_default();
    let usage = index_usage(&collection).await.unwrap_or_default();

    let mut indexes: Vec<IndexInfo> = specs
        .iter()
        .filter_map(Bson::as_document)
        .map(|spec| to_info(spec, &sizes, &usage))
        .collect();
    // `_id_` first, then by name, like the shell shows them.
    indexes.sort_by(|a, b| (a.name != ID_INDEX, &a.name).cmp(&(b.name != ID_INDEX, &b.name)));
    Ok(indexes)
}

/// Returns the name of the created index.
pub async fn create(
    handle: &ConnectionHandle,
    namespace: &Namespace,
    request: CreateIndexRequest,
) -> Result<String, CoreError> {
    handle.ensure_writable()?;
    let keys = Document::try_from(request.keys)?;
    if keys.is_empty() {
        return Err(CoreError::Validation(
            "an index needs at least one key".into(),
        ));
    }
    let partial_filter = request.partial_filter.map(Document::try_from).transpose()?;
    let options = IndexOptions::builder()
        .name(request.name.filter(|name| !name.trim().is_empty()))
        .unique(request.unique.then_some(true))
        .sparse(request.sparse.then_some(true))
        .hidden(request.hidden.then_some(true))
        .expire_after(
            request
                .expire_after_seconds
                .map(|s| Duration::from_secs(u64::from(s))),
        )
        .partial_filter_expression(partial_filter)
        .build();
    let result = namespace
        .collection(handle)?
        .create_index(IndexModel::builder().keys(keys).options(options).build())
        .await?;
    Ok(result.index_name)
}

pub async fn drop(
    handle: &ConnectionHandle,
    namespace: &Namespace,
    name: &str,
) -> Result<(), CoreError> {
    handle.ensure_writable()?;
    if name == ID_INDEX {
        return Err(CoreError::Validation(
            "the _id index cannot be dropped".into(),
        ));
    }
    namespace.collection(handle)?.drop_index(name).await?;
    Ok(())
}

fn to_info(
    spec: &Document,
    sizes: &HashMap<String, f64>,
    usage: &HashMap<String, (f64, String)>,
) -> IndexInfo {
    let name = spec.get_str("name").unwrap_or_default().to_owned();
    let flag = |key: &str| spec.get_bool(key).unwrap_or(false);
    IndexInfo {
        keys: EJsonDocument::from(spec.get_document("key").cloned().unwrap_or_default()),
        unique: flag("unique"),
        sparse: flag("sparse"),
        hidden: flag("hidden"),
        expire_after_seconds: spec.get("expireAfterSeconds").and_then(as_f64),
        partial_filter: spec
            .get_document("partialFilterExpression")
            .ok()
            .cloned()
            .map(EJsonDocument::from),
        definition: EJsonDocument::from(spec.clone()),
        size: sizes.get(&name).copied(),
        usage_count: usage.get(&name).map(|(ops, _)| *ops),
        usage_since: usage.get(&name).map(|(_, since)| since.clone()),
        name,
    }
}

async fn index_sizes(
    collection: &mongodb::Collection<Document>,
) -> Result<HashMap<String, f64>, CoreError> {
    let mut cursor = collection
        .aggregate([doc! { "$collStats": { "storageStats": {} } }])
        .await?;
    let mut sizes = HashMap::new();
    // Sharded collections return one document per shard: sizes add up.
    while cursor.advance().await? {
        let stats = cursor.deserialize_current()?;
        if let Ok(per_index) = stats
            .get_document("storageStats")
            .and_then(|storage| storage.get_document("indexSizes"))
        {
            for (name, size) in per_index {
                *sizes.entry(name.clone()).or_insert(0.0) += as_f64(size).unwrap_or(0.0);
            }
        }
    }
    Ok(sizes)
}

async fn index_usage(
    collection: &mongodb::Collection<Document>,
) -> Result<HashMap<String, (f64, String)>, CoreError> {
    let mut cursor = collection.aggregate([doc! { "$indexStats": {} }]).await?;
    let mut usage = HashMap::new();
    while cursor.advance().await? {
        let stats = cursor.deserialize_current()?;
        let Ok(name) = stats.get_str("name") else {
            continue;
        };
        let Ok(accesses) = stats.get_document("accesses") else {
            continue;
        };
        let ops = accesses.get("ops").and_then(as_f64).unwrap_or(0.0);
        let since = accesses
            .get_datetime("since")
            .map(|date| date.try_to_rfc3339_string().unwrap_or_default())
            .unwrap_or_default();
        let entry = usage.entry(name.to_owned()).or_insert((0.0, since));
        entry.0 += ops;
    }
    Ok(usage)
}

#[allow(clippy::cast_precision_loss)]
fn as_f64(value: &Bson) -> Option<f64> {
    match value {
        Bson::Int32(n) => Some(f64::from(*n)),
        Bson::Int64(n) => Some(*n as f64),
        Bson::Double(n) => Some(*n),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_every_option_from_a_raw_spec() {
        let spec = doc! {
            "v": 2,
            "key": { "email": 1, "createdAt": -1 },
            "name": "email_1_createdAt_-1",
            "unique": true,
            "hidden": true,
            "expireAfterSeconds": 3600,
            "partialFilterExpression": { "active": true },
        };
        let sizes = HashMap::from([("email_1_createdAt_-1".to_owned(), 4096.0)]);
        let info = to_info(&spec, &sizes, &HashMap::new());

        assert_eq!(info.name, "email_1_createdAt_-1");
        assert!(info.unique && info.hidden && !info.sparse);
        assert_eq!(info.expire_after_seconds, Some(3600.0));
        assert_eq!(info.size, Some(4096.0));
        assert_eq!(info.usage_count, None);
        assert_eq!(
            info.partial_filter,
            Some(EJsonDocument::from(doc! { "active": true }))
        );
        assert_eq!(info.definition, EJsonDocument::from(spec));
    }
}
