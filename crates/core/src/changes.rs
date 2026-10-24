//! A collection's changes as they happen, from a change stream (ADR-0046).

use bson::{Bson, Document};
use mongodb::change_stream::event::{ChangeStreamEvent, OperationType};
use mongodb::options::FullDocumentType;
use serde::Serialize;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use crate::CoreError;
use crate::connection::ConnectionHandle;
use crate::ejson::EJsonDocument;
use crate::query::Namespace;

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ChangeEvent {
    /// `insert`, `update`, `replace`, `delete`, `drop`, `rename`, `invalidate`…
    pub operation: String,
    /// Milliseconds since the epoch, when the server reports it.
    pub at: Option<f64>,
    /// `{ _id: … }` of the changed document.
    pub key: Option<EJsonDocument>,
    /// The document after the change (inserts, replaces, and updates looked up afterwards).
    pub document: Option<EJsonDocument>,
    /// What an update set, and which fields it removed.
    pub updated: Option<EJsonDocument>,
    pub removed: Vec<String>,
}

/// What the feed sends: changes, and how many were dropped because the UI fell behind.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
pub enum ChangeFeed {
    Change(ChangeEvent),
    Skipped(f64),
}

/// Streams the collection's changes until cancelled. Needs a replica set or sharded cluster.
pub async fn watch(
    handle: &ConnectionHandle,
    namespace: &Namespace,
    feed: mpsc::Sender<ChangeFeed>,
    cancel: CancellationToken,
) -> Result<(), CoreError> {
    let mut stream = namespace
        .collection(handle)?
        .watch()
        .full_document(FullDocumentType::UpdateLookup)
        .await
        .map_err(standalone_hint)?;
    let mut skipped = 0.0;
    loop {
        let next = tokio::select! {
            biased;
            () = cancel.cancelled() => return Ok(()),
            next = stream.next_if_any() => next.map_err(standalone_hint)?,
        };
        let Some(event) = next else {
            // Nothing new yet: the driver returns after its own short wait.
            continue;
        };
        let invalidated = event.operation_type == OperationType::Invalidate;
        // A busy collection must not grow an unbounded queue toward the UI: drop and count.
        if feed.try_send(ChangeFeed::Change(change_of(event))).is_err() {
            skipped += 1.0;
        } else if skipped > 0.0 && feed.try_send(ChangeFeed::Skipped(skipped)).is_ok() {
            skipped = 0.0;
        }
        if invalidated {
            return Ok(());
        }
    }
}

fn change_of(event: ChangeStreamEvent<Document>) -> ChangeEvent {
    let operation = match bson::serialize_to_bson(&event.operation_type) {
        Ok(Bson::String(name)) => name,
        _ => format!("{:?}", event.operation_type).to_lowercase(),
    };
    #[allow(clippy::cast_precision_loss)]
    let at = event
        .wall_time
        .map(|time| time.timestamp_millis() as f64)
        .or_else(|| event.cluster_time.map(|time| f64::from(time.time) * 1000.0));
    let (updated, removed) = event
        .update_description
        .map_or((None, Vec::new()), |description| {
            (
                Some(EJsonDocument::from(description.updated_fields)),
                description.removed_fields,
            )
        });
    ChangeEvent {
        operation,
        at,
        key: event.document_key.map(EJsonDocument::from),
        document: event.full_document.map(EJsonDocument::from),
        updated,
        removed,
    }
}

/// A standalone server cannot open change streams; say so plainly.
fn standalone_hint(error: mongodb::error::Error) -> CoreError {
    let core = CoreError::from(error);
    let text = core.to_string();
    if text.contains("replica set") || text.contains("$changeStream") {
        CoreError::Validation(
            "live changes need a replica set or a sharded cluster; this server is standalone"
                .into(),
        )
    } else {
        core
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bson::doc;

    #[test]
    fn reads_an_update_event() {
        let event: ChangeStreamEvent<Document> = bson::deserialize_from_document(doc! {
            "_id": { "_data": "8264" },
            "operationType": "update",
            "documentKey": { "_id": 7 },
            "updateDescription": { "updatedFields": { "status": "paid" }, "removedFields": ["draft"] },
            "fullDocument": { "_id": 7, "status": "paid" },
            "wallTime": bson::DateTime::from_millis(1_700_000_000_000),
        })
        .expect("event");
        let change = change_of(event);
        assert_eq!(change.operation, "update");
        assert_eq!(change.at, Some(1_700_000_000_000.0));
        assert_eq!(change.removed, ["draft"]);
        assert!(change.updated.is_some() && change.document.is_some() && change.key.is_some());
    }
}
