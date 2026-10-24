//! Queries with cursors held in core and paged on demand by the UI (ADR-0009, ADR-0025).

use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use bson::{Bson, Document};
use mongodb::options::{Collation, Hint};
use mongodb::{Collection, Cursor};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::CoreError;
use crate::connection::{ConnectionHandle, ConnectionId};
use crate::ejson::{EJsonDocument, EJsonValue};

pub const MAX_BATCH_SIZE: u32 = 1000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct Namespace {
    pub database: String,
    pub collection: String,
}

impl Namespace {
    pub(crate) fn collection(
        &self,
        handle: &ConnectionHandle,
    ) -> Result<Collection<Document>, CoreError> {
        if self.database.is_empty() || self.collection.is_empty() {
            return Err(CoreError::Validation(
                "database and collection names are required".into(),
            ));
        }
        Ok(handle
            .client
            .database(&self.database)
            .collection(&self.collection))
    }
}

#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct FindRequest {
    pub filter: EJsonDocument,
    pub projection: Option<EJsonDocument>,
    pub sort: Option<EJsonDocument>,
    pub skip: Option<u32>,
    pub limit: Option<u32>,
    pub batch_size: u32,
    #[serde(default)]
    pub options: QueryOptions,
}

#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct AggregateRequest {
    pub pipeline: Vec<EJsonDocument>,
    pub batch_size: u32,
    #[serde(default)]
    pub options: QueryOptions,
}

/// What a query may add besides its filter (ADR-0052): how strings compare, which index to
/// use, and how long the server may work on it.
#[derive(Debug, Clone, Default, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct QueryOptions {
    /// e.g. `{ locale: "en", strength: 2 }` for case-insensitive matching.
    #[serde(default)]
    pub collation: Option<EJsonDocument>,
    /// An index name, or its keys.
    #[serde(default)]
    pub hint: Option<EJsonValue>,
    /// The server stops the query past this many milliseconds; `None` lets it run.
    #[serde(default)]
    pub max_time_ms: Option<u32>,
}

impl QueryOptions {
    pub(crate) fn collation(&self) -> Result<Option<Collation>, CoreError> {
        self.collation
            .clone()
            .map(|collation| {
                bson::deserialize_from_document::<Collation>(Document::try_from(collation)?)
                    .map_err(|error| CoreError::Validation(format!("collation: {error}")))
            })
            .transpose()
    }

    pub(crate) fn hint(&self) -> Result<Option<Hint>, CoreError> {
        let Some(hint) = self.hint.clone() else {
            return Ok(None);
        };
        match Bson::try_from(hint)? {
            Bson::String(name) if !name.trim().is_empty() => Ok(Some(Hint::Name(name))),
            Bson::Document(keys) if !keys.is_empty() => Ok(Some(Hint::Keys(keys))),
            _ => Err(CoreError::Validation(
                "hint: an index name or its keys, like { email: 1 }".into(),
            )),
        }
    }

    pub(crate) fn max_time(&self) -> Option<Duration> {
        self.max_time_ms
            .filter(|ms| *ms > 0)
            .map(|ms| Duration::from_millis(u64::from(ms)))
    }

    /// The same options as fields of a raw command, as `explain` takes them.
    pub(crate) fn add_to(&self, command: &mut Document) -> Result<(), CoreError> {
        if let Some(collation) = self.collation.clone() {
            command.insert("collation", Document::try_from(collation)?);
        }
        if let Some(hint) = self.hint()? {
            command.insert(
                "hint",
                match hint {
                    Hint::Name(name) => Bson::String(name),
                    Hint::Keys(keys) => Bson::Document(keys),
                    _ => Bson::Null,
                },
            );
        }
        if let Some(ms) = self.max_time_ms.filter(|ms| *ms > 0) {
            command.insert("maxTimeMS", i64::from(ms));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(transparent)]
pub struct CursorId(Uuid);

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct DocumentPage {
    pub documents: Vec<EJsonDocument>,
    /// `None` once the cursor is exhausted; otherwise pass it to `fetch_more`.
    pub cursor_id: Option<CursorId>,
}

struct OpenCursor {
    connection: ConnectionId,
    cursor: Arc<tokio::sync::Mutex<Cursor<Document>>>,
}

/// Open server-side cursors. Dropping a `Cursor` makes the driver kill it on the server.
#[derive(Default)]
pub struct CursorRegistry {
    cursors: Mutex<HashMap<CursorId, OpenCursor>>,
}

impl std::fmt::Debug for CursorRegistry {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CursorRegistry")
            .field("open", &self.lock().len())
            .finish()
    }
}

impl CursorRegistry {
    pub async fn find(
        &self,
        handle: &ConnectionHandle,
        namespace: &Namespace,
        request: FindRequest,
    ) -> Result<DocumentPage, CoreError> {
        let batch_size = validate_batch_size(request.batch_size)?;
        let cursor = find_cursor(handle, namespace, request).await?;
        self.first_page(handle, cursor, batch_size).await
    }

    /// Runs an aggregation pipeline, paged exactly like `find`.
    /// Write stages (`$out`, `$merge`) are refused on read-only connections.
    pub async fn aggregate(
        &self,
        handle: &ConnectionHandle,
        namespace: &Namespace,
        request: AggregateRequest,
    ) -> Result<DocumentPage, CoreError> {
        let batch_size = validate_batch_size(request.batch_size)?;
        let cursor = aggregate_cursor(
            handle,
            namespace,
            request.pipeline,
            batch_size,
            &request.options,
        )
        .await?;
        self.first_page(handle, cursor, batch_size).await
    }

    async fn first_page(
        &self,
        handle: &ConnectionHandle,
        mut cursor: Cursor<Document>,
        batch_size: u32,
    ) -> Result<DocumentPage, CoreError> {
        let documents = read_batch(&mut cursor, batch_size).await?;
        if !cursor.has_next() {
            return Ok(DocumentPage {
                documents,
                cursor_id: None,
            });
        }

        let id = CursorId(Uuid::now_v7());
        self.lock().insert(
            id,
            OpenCursor {
                connection: handle.info.id,
                cursor: Arc::new(tokio::sync::Mutex::new(cursor)),
            },
        );
        Ok(DocumentPage {
            documents,
            cursor_id: Some(id),
        })
    }

    pub async fn fetch_more(
        &self,
        id: CursorId,
        batch_size: u32,
    ) -> Result<DocumentPage, CoreError> {
        let batch_size = validate_batch_size(batch_size)?;
        let cursor = self
            .lock()
            .get(&id)
            .map(|open| Arc::clone(&open.cursor))
            .ok_or(CoreError::NotFound("cursor"))?;

        let mut cursor = cursor.lock().await;
        let result = read_batch(&mut cursor, batch_size).await;
        let exhausted = !(result.is_ok() && cursor.has_next());
        drop(cursor);
        if exhausted {
            self.close(id);
        }
        Ok(DocumentPage {
            documents: result?,
            cursor_id: (!exhausted).then_some(id),
        })
    }

    pub fn close(&self, id: CursorId) {
        self.lock().remove(&id);
    }

    pub fn close_for_connection(&self, connection: ConnectionId) {
        self.lock().retain(|_, open| open.connection != connection);
    }

    fn lock(&self) -> MutexGuard<'_, HashMap<CursorId, OpenCursor>> {
        self.cursors.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// Opens a find cursor; shared by paging and export.
pub(crate) async fn find_cursor(
    handle: &ConnectionHandle,
    namespace: &Namespace,
    request: FindRequest,
) -> Result<Cursor<Document>, CoreError> {
    let batch_size = validate_batch_size(request.batch_size)?;
    let collection = namespace.collection(handle)?;
    let mut find = collection
        .find(Document::try_from(request.filter)?)
        .batch_size(batch_size);
    if let Some(projection) = request.projection {
        find = find.projection(Document::try_from(projection)?);
    }
    if let Some(sort) = request.sort {
        find = find.sort(Document::try_from(sort)?);
    }
    if let Some(skip) = request.skip {
        find = find.skip(u64::from(skip));
    }
    if let Some(limit) = request.limit {
        find = find.limit(i64::from(limit));
    }
    if let Some(collation) = request.options.collation()? {
        find = find.collation(collation);
    }
    if let Some(hint) = request.options.hint()? {
        find = find.hint(hint);
    }
    if let Some(max_time) = request.options.max_time() {
        find = find.max_time(max_time);
    }
    Ok(find.await?)
}

/// Opens an aggregation cursor; write stages require a writable connection.
pub(crate) async fn aggregate_cursor(
    handle: &ConnectionHandle,
    namespace: &Namespace,
    pipeline: Vec<EJsonDocument>,
    batch_size: u32,
    options: &QueryOptions,
) -> Result<Cursor<Document>, CoreError> {
    let batch_size = validate_batch_size(batch_size)?;
    let pipeline = to_pipeline(pipeline)?;
    if has_write_stage(&pipeline) {
        handle.ensure_writable()?;
    }
    let collection = namespace.collection(handle)?;
    let mut aggregate = collection
        .aggregate(pipeline)
        .batch_size(batch_size)
        .allow_disk_use(true);
    if let Some(collation) = options.collation()? {
        aggregate = aggregate.collation(collation);
    }
    if let Some(hint) = options.hint()? {
        aggregate = aggregate.hint(hint);
    }
    if let Some(max_time) = options.max_time() {
        aggregate = aggregate.max_time(max_time);
    }
    Ok(aggregate.await?)
}

/// The first `limit` results of a pipeline, for the stage previews of the
/// aggregation builder. Nothing is kept open, and write stages are never run:
/// a preview must not change data (ADR-0012).
pub async fn preview_aggregation(
    handle: &ConnectionHandle,
    namespace: &Namespace,
    pipeline: Vec<EJsonDocument>,
    limit: u32,
) -> Result<Vec<EJsonDocument>, CoreError> {
    let limit = validate_batch_size(limit)?;
    let mut pipeline = to_pipeline(pipeline)?;
    if has_write_stage(&pipeline) {
        return Err(CoreError::Validation(
            "pipelines with $out or $merge cannot be previewed".into(),
        ));
    }
    pipeline.push(bson::doc! { "$limit": i64::from(limit) });
    let mut cursor = namespace
        .collection(handle)?
        .aggregate(pipeline)
        .batch_size(limit)
        .allow_disk_use(true)
        .await?;
    read_batch(&mut cursor, limit).await
}

pub async fn count_documents(
    handle: &ConnectionHandle,
    namespace: &Namespace,
    filter: EJsonDocument,
    options: &QueryOptions,
) -> Result<f64, CoreError> {
    let collection = namespace.collection(handle)?;
    let mut count = collection.count_documents(Document::try_from(filter)?);
    if let Some(collation) = options.collation()? {
        count = count.collation(collation);
    }
    if let Some(hint) = options.hint()? {
        count = count.hint(hint);
    }
    if let Some(max_time) = options.max_time() {
        count = count.max_time(max_time);
    }
    let count = count.await?;
    #[allow(clippy::cast_precision_loss)]
    Ok(count as f64)
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct DistinctValue {
    /// `null` stands for both null and a missing field.
    pub value: EJsonValue,
    pub count: f64,
}

/// The most common values of `field` among documents matching `filter`, with
/// their counts. Array elements count individually, like the `distinct` command.
pub async fn distinct_values(
    handle: &ConnectionHandle,
    namespace: &Namespace,
    field: &str,
    filter: EJsonDocument,
    limit: u32,
) -> Result<Vec<DistinctValue>, CoreError> {
    if field.is_empty() || field.starts_with('$') {
        return Err(CoreError::Validation(format!(
            "{field} is not a field path"
        )));
    }
    let path = format!("${field}");
    let pipeline = vec![
        bson::doc! { "$match": Document::try_from(filter)? },
        bson::doc! { "$unwind": { "path": &path, "preserveNullAndEmptyArrays": true } },
        bson::doc! { "$group": { "_id": &path, "count": { "$sum": 1 } } },
        // Ties by value keep the order stable between runs.
        bson::doc! { "$sort": { "count": -1, "_id": 1 } },
        bson::doc! { "$limit": i64::from(limit.clamp(1, 1000)) },
    ];
    let mut cursor = namespace.collection(handle)?.aggregate(pipeline).await?;
    let mut values = Vec::new();
    while cursor.advance().await? {
        let document = cursor.deserialize_current()?;
        values.push(DistinctValue {
            value: EJsonValue::from(document.get("_id").cloned().unwrap_or(bson::Bson::Null)),
            count: document.get("count").map_or(0.0, crate::ejson::number_of),
        });
    }
    Ok(values)
}

fn to_pipeline(stages: Vec<EJsonDocument>) -> Result<Vec<Document>, CoreError> {
    stages
        .into_iter()
        .map(|stage| {
            let stage = Document::try_from(stage)?;
            if stage.len() != 1 || !stage.keys().all(|key| key.starts_with('$')) {
                return Err(CoreError::Validation(
                    "each stage must be a document with a single $operator".into(),
                ));
            }
            Ok(stage)
        })
        .collect()
}

fn has_write_stage(pipeline: &[Document]) -> bool {
    pipeline
        .iter()
        .any(|stage| stage.contains_key("$out") || stage.contains_key("$merge"))
}

fn validate_batch_size(batch_size: u32) -> Result<u32, CoreError> {
    if batch_size == 0 || batch_size > MAX_BATCH_SIZE {
        return Err(CoreError::Validation(format!(
            "batch size must be between 1 and {MAX_BATCH_SIZE}"
        )));
    }
    Ok(batch_size)
}

async fn read_batch(
    cursor: &mut Cursor<Document>,
    size: u32,
) -> Result<Vec<EJsonDocument>, CoreError> {
    let mut documents = Vec::with_capacity(size as usize);
    while documents.len() < size as usize && cursor.advance().await? {
        documents.push(EJsonDocument::from(cursor.deserialize_current()?));
    }
    Ok(documents)
}

#[cfg(test)]
mod tests {
    use bson::doc;

    use super::*;

    #[test]
    fn pipelines_must_be_single_operator_stages() {
        let valid = vec![EJsonDocument::from(doc! { "$match": { "a": 1 } })];
        assert!(to_pipeline(valid).is_ok());

        let two_keys = vec![EJsonDocument::from(doc! { "$match": {}, "$limit": 1 })];
        assert!(matches!(
            to_pipeline(two_keys),
            Err(CoreError::Validation(_))
        ));

        let not_an_operator = vec![EJsonDocument::from(doc! { "match": {} })];
        assert!(matches!(
            to_pipeline(not_an_operator),
            Err(CoreError::Validation(_))
        ));
    }

    #[test]
    fn detects_write_stages() {
        assert!(has_write_stage(&[
            doc! { "$match": {} },
            doc! { "$out": "copy" }
        ]));
        assert!(has_write_stage(&[doc! { "$merge": { "into": "copy" } }]));
        assert!(!has_write_stage(&[doc! { "$group": { "_id": "$a" } }]));
    }
}
