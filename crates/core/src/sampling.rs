//! Bounded reads for features that look at many documents at once: schema, schema compare,
//! diagram, value search, distinct values (ADR-0060). None of them may cost the server more than
//! [`MAX_SCANNED`] documents per sample or [`SCAN_TIME_LIMIT`] per request.

use std::time::Duration;

use bson::{Document, doc};

use crate::CoreError;
use crate::browse::CollectionKind;
use crate::connection::ConnectionHandle;
use crate::query::Namespace;

/// Server-side limit for any scan, enforced by the server even after the operation is cancelled
/// here: dropping a request does not stop an aggregation still computing its first batch.
pub const SCAN_TIME_LIMIT: Duration = Duration::from_secs(30);
/// Documents a sample may read when the server cannot pick them at random.
pub const MAX_SCANNED: i64 = 10_000;
/// An estimated count is metadata on a plain collection, but a time series may have to count its
/// buckets' measurements: a count that takes longer than this is not worth showing.
pub const COUNT_TIME_LIMIT: Duration = Duration::from_secs(5);

/// The pipeline that samples `size` documents matching `filter`.
///
/// `$sample` as the first stage of a plain collection picks documents with a random cursor.
/// Anywhere else (after a `$match`, on a view, on a time series whose buckets are not full) the
/// server reads every input document and sorts them at random: there the input is capped, and
/// the sample comes from the first [`MAX_SCANNED`] matching documents.
#[must_use]
pub fn sample_pipeline(kind: CollectionKind, filter: Document, size: u32) -> Vec<Document> {
    let sample = doc! { "$sample": { "size": i64::from(size) } };
    if filter.is_empty() && kind == CollectionKind::Collection {
        return vec![sample];
    }
    let matching = (!filter.is_empty()).then(|| doc! { "$match": filter });
    matching
        .into_iter()
        .chain([doc! { "$limit": MAX_SCANNED }, sample])
        .collect()
}

/// Samples up to `size` documents of a collection whose kind is known.
pub async fn sample_documents(
    collection: &mongodb::Collection<Document>,
    kind: CollectionKind,
    filter: Document,
    size: u32,
) -> Result<Vec<Document>, CoreError> {
    let mut cursor = collection
        .aggregate(sample_pipeline(kind, filter, size))
        .max_time(SCAN_TIME_LIMIT)
        .await?;
    let mut documents = Vec::with_capacity(size as usize);
    while cursor.advance().await? {
        documents.push(cursor.deserialize_current()?);
    }
    Ok(documents)
}

/// Whether `namespace` is a collection, a view or a time series. One that is not listed (not
/// created yet, or hidden from the user) reads as a view: capped, the safe side.
pub async fn collection_kind(
    handle: &ConnectionHandle,
    namespace: &Namespace,
) -> Result<CollectionKind, CoreError> {
    use mongodb::results::CollectionType;

    let mut cursor = handle
        .client
        .database(&namespace.database)
        .list_collections()
        .filter(doc! { "name": &namespace.collection })
        .authorized_collections(true)
        .await?;
    if !cursor.advance().await? {
        return Ok(CollectionKind::View);
    }
    Ok(match cursor.deserialize_current()?.collection_type {
        CollectionType::Collection => CollectionKind::Collection,
        CollectionType::Timeseries => CollectionKind::Timeseries,
        _ => CollectionKind::View,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stages(pipeline: &[Document]) -> Vec<&str> {
        pipeline
            .iter()
            .filter_map(|stage| stage.keys().next().map(String::as_str))
            .collect()
    }

    #[test]
    fn a_whole_collection_is_sampled_at_random() {
        let pipeline = sample_pipeline(CollectionKind::Collection, doc! {}, 200);
        assert_eq!(pipeline, [doc! { "$sample": { "size": 200_i64 } }]);
    }

    #[test]
    fn time_series_and_views_read_at_most_max_scanned() {
        for kind in [CollectionKind::Timeseries, CollectionKind::View] {
            let pipeline = sample_pipeline(kind, doc! {}, 200);
            assert_eq!(stages(&pipeline), ["$limit", "$sample"]);
            assert_eq!(pipeline[0], doc! { "$limit": MAX_SCANNED });
        }
    }

    #[test]
    fn a_filtered_sample_reads_at_most_max_scanned_matches() {
        let pipeline = sample_pipeline(CollectionKind::Collection, doc! { "kind": "vip" }, 200);
        assert_eq!(stages(&pipeline), ["$match", "$limit", "$sample"]);
        assert_eq!(pipeline[0], doc! { "$match": { "kind": "vip" } });
    }
}
