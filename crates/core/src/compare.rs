//! Compares two collections document by document, matched by `_id` (ADR-0041).
//!
//! Two passes keep memory bounded whatever the size: the left side is read in batches and
//! each batch is looked up on the right with `$in`, then only the right side's ids are read
//! to find documents the left lacks. Matching uses the server's own `_id` equality, so ids
//! of mixed types need no client-side ordering.

use std::collections::HashMap;

use bson::{Bson, Document, doc};
use mongodb::Cursor;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use crate::CoreError;
use crate::connection::ConnectionHandle;
use crate::ejson::{EJsonDocument, EJsonValue};
use crate::query::Namespace;

const BATCH: usize = 1000;
/// Ids kept per category for the UI to show; the counts are always complete.
pub const MAX_SAMPLES: usize = 200;

#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct CompareRequest {
    pub left: Namespace,
    pub right: Namespace,
    /// Limits the comparison to matching documents on both sides.
    pub filter: Option<EJsonDocument>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct CompareProgress {
    /// Documents read so far, both sides together.
    pub compared: f64,
    pub total: f64,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct CompareSummary {
    pub identical: f64,
    pub different: f64,
    pub only_left: f64,
    pub only_right: f64,
    /// The first ids of each kind, up to [`MAX_SAMPLES`].
    pub different_ids: Vec<EJsonValue>,
    pub only_left_ids: Vec<EJsonValue>,
    pub only_right_ids: Vec<EJsonValue>,
}

/// One document from each side, `None` where it is missing.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ComparedPair {
    pub left: Option<EJsonDocument>,
    pub right: Option<EJsonDocument>,
}

pub async fn compare(
    left: &ConnectionHandle,
    right: &ConnectionHandle,
    request: CompareRequest,
    progress: mpsc::Sender<CompareProgress>,
    cancel: CancellationToken,
) -> Result<CompareSummary, CoreError> {
    let filter = match request.filter {
        Some(filter) => Document::try_from(filter)?,
        None => Document::new(),
    };
    let left_collection = request.left.collection(left)?;
    let right_collection = request.right.collection(right)?;
    let total = left_collection.count_documents(filter.clone()).await?
        + right_collection.count_documents(filter.clone()).await?;
    #[allow(clippy::cast_precision_loss)]
    let total = total as f64;
    let mut summary = CompareSummary::default();
    let mut compared = 0.0;
    let mut report = |count: usize| {
        #[allow(clippy::cast_precision_loss)]
        {
            compared += count as f64;
        }
        // Lossy on purpose: a slow UI must not slow the comparison.
        let _ = progress.try_send(CompareProgress { compared, total });
    };

    // Pass 1: every left document against its right counterpart.
    let mut cursor = left_collection
        .find(filter.clone())
        .batch_size(1000)
        .await?;
    let mut batch = Vec::with_capacity(BATCH);
    loop {
        let next = next_document(&mut cursor, &cancel).await?;
        let done = next.is_none();
        if let Some(document) = next {
            batch.push(document);
        }
        if batch.len() == BATCH || (done && !batch.is_empty()) {
            let ids: Vec<Bson> = batch.iter().filter_map(|d| d.get("_id").cloned()).collect();
            let found: HashMap<String, Document> = all(right_collection
                .find(doc! { "_id": { "$in": ids } })
                .await?)
            .await?
            .into_iter()
            .filter_map(|document| Some((id_key(document.get("_id")?), document)))
            .collect();
            let count = batch.len();
            for document in batch.drain(..) {
                let Some(id) = document.get("_id").cloned() else {
                    continue;
                };
                match found.get(&id_key(&id)) {
                    None => record(&mut summary.only_left, &mut summary.only_left_ids, id),
                    Some(other) if same_document(&document, other) => summary.identical += 1.0,
                    Some(_) => record(&mut summary.different, &mut summary.different_ids, id),
                }
            }
            report(count);
        }
        if done {
            break;
        }
    }

    // Pass 2: right ids the left does not have.
    let mut cursor = right_collection
        .find(filter)
        .projection(doc! { "_id": 1 })
        .batch_size(5000)
        .await?;
    let mut ids = Vec::with_capacity(BATCH);
    loop {
        let next = next_document(&mut cursor, &cancel).await?;
        let done = next.is_none();
        if let Some(id) = next.and_then(|document| document.get("_id").cloned()) {
            ids.push(id);
        }
        if ids.len() == BATCH || (done && !ids.is_empty()) {
            let present: std::collections::HashSet<String> = all(left_collection
                .find(doc! { "_id": { "$in": ids.clone() } })
                .projection(doc! { "_id": 1 })
                .await?)
            .await?
            .iter()
            .filter_map(|document| document.get("_id").map(id_key))
            .collect();
            let count = ids.len();
            for id in ids.drain(..) {
                if !present.contains(&id_key(&id)) {
                    record(&mut summary.only_right, &mut summary.only_right_ids, id);
                }
            }
            report(count);
        }
        if done {
            break;
        }
    }
    let _ = progress.try_send(CompareProgress {
        compared: total,
        total,
    });
    Ok(summary)
}

/// Both sides of one compared id, for the field-by-field view.
pub async fn pair(
    left: &ConnectionHandle,
    right: &ConnectionHandle,
    left_namespace: &Namespace,
    right_namespace: &Namespace,
    id: EJsonValue,
) -> Result<ComparedPair, CoreError> {
    let id = Bson::try_from(id)?;
    let left_document = left_namespace
        .collection(left)?
        .find_one(doc! { "_id": id.clone() })
        .await?;
    let right_document = right_namespace
        .collection(right)?
        .find_one(doc! { "_id": id })
        .await?;
    Ok(ComparedPair {
        left: left_document.map(Into::into),
        right: right_document.map(Into::into),
    })
}

async fn next_document(
    cursor: &mut Cursor<Document>,
    cancel: &CancellationToken,
) -> Result<Option<Document>, CoreError> {
    let advanced = tokio::select! {
        () = cancel.cancelled() => return Err(CoreError::Cancelled),
        advanced = cursor.advance() => advanced?,
    };
    Ok(if advanced {
        Some(cursor.deserialize_current()?)
    } else {
        None
    })
}

/// One batch of lookups: at most `BATCH` documents, so collecting them is bounded.
async fn all(mut cursor: Cursor<Document>) -> Result<Vec<Document>, CoreError> {
    let mut documents = Vec::new();
    while cursor.advance().await? {
        documents.push(cursor.deserialize_current()?);
    }
    Ok(documents)
}

fn record(count: &mut f64, samples: &mut Vec<EJsonValue>, id: Bson) {
    *count += 1.0;
    if samples.len() < MAX_SAMPLES {
        samples.push(id.into());
    }
}

/// A hashable form of an `_id` that keeps BSON types apart (`1` and `"1"` differ).
fn id_key(id: &Bson) -> String {
    id.clone().into_canonical_extjson().to_string()
}

/// Equal values with fields in any order: `{a, b}` and `{b, a}` are the same document.
fn same_document(left: &Document, right: &Document) -> bool {
    left.len() == right.len()
        && left
            .iter()
            .all(|(key, value)| right.get(key).is_some_and(|other| same_value(value, other)))
}

fn same_value(left: &Bson, right: &Bson) -> bool {
    match (left, right) {
        (Bson::Document(left), Bson::Document(right)) => same_document(left, right),
        (Bson::Array(left), Bson::Array(right)) => {
            left.len() == right.len() && left.iter().zip(right).all(|(l, r)| same_value(l, r))
        }
        _ => left == right,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn field_order_does_not_matter_but_types_and_array_order_do() {
        let a = doc! { "a": 1, "b": { "x": 1, "y": [1, 2] } };
        assert!(same_document(
            &a,
            &doc! { "b": { "y": [1, 2], "x": 1 }, "a": 1 }
        ));
        assert!(!same_document(
            &a,
            &doc! { "a": 1_i64, "b": { "x": 1, "y": [1, 2] } }
        ));
        assert!(!same_document(
            &a,
            &doc! { "a": 1, "b": { "x": 1, "y": [2, 1] } }
        ));
        assert!(!same_document(&a, &doc! { "a": 1 }));
        assert!(!same_document(&doc! { "a": 1 }, &doc! { "a": 1, "b": 2 }));
    }

    #[test]
    fn ids_of_different_types_stay_apart() {
        assert_ne!(id_key(&Bson::Int32(1)), id_key(&Bson::String("1".into())));
        assert_ne!(id_key(&Bson::Int32(1)), id_key(&Bson::Int64(1)));
    }

    #[test]
    fn samples_are_capped_but_counts_are_not() {
        let (mut count, mut samples) = (0.0, Vec::new());
        for i in 0..250 {
            record(&mut count, &mut samples, Bson::Int32(i));
        }
        assert!((count - 250.0).abs() < f64::EPSILON);
        assert_eq!(samples.len(), MAX_SAMPLES);
    }
}
