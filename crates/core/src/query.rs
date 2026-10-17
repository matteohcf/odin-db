//! Queries with cursors held in core and paged on demand by the UI (ADR-0009, ADR-0025).

use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use bson::Document;
use mongodb::{Collection, Cursor};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::CoreError;
use crate::connection::{ConnectionHandle, ConnectionId};
use crate::ejson::EJsonDocument;

pub const MAX_BATCH_SIZE: u32 = 1000;

#[derive(Debug, Clone, Deserialize)]
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

        let mut cursor = find.await?;
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

pub async fn count_documents(
    handle: &ConnectionHandle,
    namespace: &Namespace,
    filter: EJsonDocument,
) -> Result<f64, CoreError> {
    let count = namespace
        .collection(handle)?
        .count_documents(Document::try_from(filter)?)
        .await?;
    #[allow(clippy::cast_precision_loss)]
    Ok(count as f64)
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
