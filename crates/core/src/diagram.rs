//! A database's collections and the references between them, inferred from sampled documents
//! (ADR-0043).

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use bson::oid::ObjectId;
use bson::{Bson, Document, doc};
use serde::Serialize;
use tokio::sync::{Semaphore, mpsc};
use tokio::task::JoinSet;
use tokio_util::sync::CancellationToken;

use crate::CoreError;
use crate::browse::{CollectionKind, list_collections};
use crate::connection::ConnectionHandle;
use crate::schema::{FieldSummary, summarize};

const SAMPLE_SIZE: i64 = 100;
const CONCURRENCY: usize = 4;
/// Fields beyond this are rarely what a diagram is read for, and make nodes unwieldy.
const MAX_FIELDS: usize = 60;
/// `ObjectId`s kept per field to look up in candidate collections.
const MAX_IDS: usize = 40;
/// Without a collection named like the field, every collection is tried only up to this size.
const MAX_BLIND_TARGETS: usize = 40;
/// A reference needs at least this share of its sampled values to exist in the target.
const MIN_MATCH: f64 = 0.5;

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct DiagramCollection {
    pub name: String,
    pub kind: CollectionKind,
    /// The server's estimate, cheap even on large collections.
    pub documents: f64,
    pub fields: Vec<FieldSummary>,
    /// Why the collection could not be sampled (e.g. not authorized).
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct DiagramLink {
    pub from: String,
    /// The referencing field's path, e.g. `customerId` or `items.productId`.
    pub field: String,
    pub to: String,
    /// The field holds an array of references: one document points at many.
    pub many: bool,
    /// Sampled values found as an `_id` of `to`, out of `checked`.
    pub matched: f64,
    pub checked: f64,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct DatabaseDiagram {
    pub collections: Vec<DiagramCollection>,
    pub links: Vec<DiagramLink>,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct DiagramProgress {
    pub done: f64,
    pub total: f64,
}

/// A field whose sampled values are `ObjectId`s, so it may point at another collection.
struct Candidate {
    from: String,
    field: String,
    many: bool,
    ids: Vec<ObjectId>,
}

pub async fn database_diagram(
    handle: &ConnectionHandle,
    database: &str,
    progress: mpsc::Sender<DiagramProgress>,
    cancel: CancellationToken,
) -> Result<DatabaseDiagram, CoreError> {
    tokio::select! {
        biased;
        () = cancel.cancelled() => Err(CoreError::Cancelled),
        diagram = build(handle, database, &progress) => diagram,
    }
}

async fn build(
    handle: &ConnectionHandle,
    database: &str,
    progress: &mpsc::Sender<DiagramProgress>,
) -> Result<DatabaseDiagram, CoreError> {
    let infos: Vec<_> = list_collections(handle, database)
        .await?
        .into_iter()
        .filter(|info| !info.name.starts_with("system."))
        .collect();
    let mut total = infos.len();
    let mut done = 0;
    let report = |done: usize, total: usize| {
        #[allow(clippy::cast_precision_loss)]
        let _ = progress.try_send(DiagramProgress {
            done: done as f64,
            total: total as f64,
        });
    };
    report(done, total);

    let permits = Arc::new(Semaphore::new(CONCURRENCY));
    let mut tasks = JoinSet::new();
    for info in infos {
        let collection = handle
            .client
            .database(database)
            .collection::<Document>(&info.name);
        let permits = Arc::clone(&permits);
        tasks.spawn(async move {
            let _permit = permits.acquire_owned().await;
            let sampled = sample(&collection).await;
            let documents = collection.estimated_document_count().await.unwrap_or(0);
            (info, documents, sampled)
        });
    }

    let mut collections = Vec::new();
    let mut candidates = Vec::new();
    while let Some(joined) = tasks.join_next().await {
        let (info, documents, sampled) =
            joined.map_err(|error| CoreError::Internal(error.to_string()))?;
        let (fields, error) = match sampled {
            Ok(sample) => {
                if info.kind != CollectionKind::View {
                    candidates.extend(candidates_of(&info.name, &sample));
                }
                let mut fields = summarize(&sample);
                fields.truncate(MAX_FIELDS);
                (fields, None)
            }
            Err(error) => (Vec::new(), Some(error.to_string())),
        };
        #[allow(clippy::cast_precision_loss)]
        collections.push(DiagramCollection {
            name: info.name,
            kind: info.kind,
            documents: documents as f64,
            fields,
            error,
        });
        done += 1;
        report(done, total);
    }
    collections.sort_by(|a, b| a.name.cmp(&b.name));

    let targets: Vec<&str> = collections
        .iter()
        .filter(|collection| collection.kind != CollectionKind::View && collection.error.is_none())
        .map(|collection| collection.name.as_str())
        .collect();
    total += candidates.len();
    report(done, total);
    let mut links = Vec::new();
    for candidate in candidates {
        if let Some(link) = resolve(handle, database, &candidate, &targets).await? {
            links.push(link);
        }
        done += 1;
        report(done, total);
    }
    Ok(DatabaseDiagram { collections, links })
}

async fn sample(collection: &mongodb::Collection<Document>) -> Result<Vec<Document>, CoreError> {
    let mut cursor = collection
        .aggregate([doc! { "$sample": { "size": SAMPLE_SIZE } }])
        .await?;
    let mut documents = Vec::new();
    while cursor.advance().await? {
        documents.push(cursor.deserialize_current()?);
    }
    Ok(documents)
}

/// ObjectId-valued paths of the sampled documents, `_id` excluded.
fn candidates_of(collection: &str, documents: &[Document]) -> Vec<Candidate> {
    let mut found: HashMap<String, (bool, Vec<ObjectId>)> = HashMap::new();
    for document in documents {
        for (key, value) in document {
            if key != "_id" {
                walk(value, key, false, &mut found);
            }
        }
    }
    let mut candidates: Vec<_> = found
        .into_iter()
        .map(|(field, (many, ids))| Candidate {
            from: collection.to_owned(),
            field,
            many,
            ids,
        })
        .collect();
    candidates.sort_by(|a, b| a.field.cmp(&b.field));
    candidates
}

fn walk(
    value: &Bson,
    path: &str,
    in_array: bool,
    found: &mut HashMap<String, (bool, Vec<ObjectId>)>,
) {
    match value {
        Bson::ObjectId(id) => {
            let entry = found.entry(path.to_owned()).or_default();
            entry.0 |= in_array;
            if entry.1.len() < MAX_IDS && !entry.1.contains(id) {
                entry.1.push(*id);
            }
        }
        Bson::Array(items) => {
            for item in items {
                walk(item, path, true, found);
            }
        }
        Bson::Document(inner) => {
            for (key, item) in inner {
                walk(item, &format!("{path}.{key}"), in_array, found);
            }
        }
        _ => {}
    }
}

/// The collection the field points at, if enough of its values exist there.
async fn resolve(
    handle: &ConnectionHandle,
    database: &str,
    candidate: &Candidate,
    targets: &[&str],
) -> Result<Option<DiagramLink>, CoreError> {
    let named: Vec<&str> = targets
        .iter()
        .copied()
        .filter(|target| names_match(&candidate.field, target))
        .collect();
    let tried: Vec<&str> = if !named.is_empty() {
        named
    } else if targets.len() <= MAX_BLIND_TARGETS {
        targets.to_vec()
    } else {
        return Ok(None);
    };
    let ids: Vec<Bson> = candidate.ids.iter().copied().map(Bson::ObjectId).collect();
    #[allow(clippy::cast_precision_loss)]
    let checked = ids.len() as f64;
    let mut best: Option<(f64, &str)> = None;
    for target in tried {
        let matched = handle
            .client
            .database(database)
            .collection::<Document>(target)
            .count_documents(doc! { "_id": { "$in": ids.clone() } })
            .await?;
        #[allow(clippy::cast_precision_loss)]
        let matched = matched as f64;
        if best.is_none_or(|(most, _)| matched > most) {
            best = Some((matched, target));
        }
    }
    Ok(best
        .filter(|(matched, _)| *matched > 0.0 && *matched / checked >= MIN_MATCH)
        .map(|(matched, to)| DiagramLink {
            from: candidate.from.clone(),
            field: candidate.field.clone(),
            to: to.to_owned(),
            many: candidate.many,
            matched,
            checked,
        }))
}

/// `customerId`, `customer_id`, `customers` or `items.productIds` name `customers` / `products`.
fn names_match(field: &str, collection: &str) -> bool {
    let last = field.rsplit('.').next().unwrap_or(field);
    let base = last.to_lowercase();
    let base = ["_ids", "ids", "_id", "id", "ref"]
        .iter()
        .find_map(|suffix| base.strip_suffix(suffix).filter(|rest| !rest.is_empty()))
        .unwrap_or(&base)
        .trim_end_matches('_')
        .to_owned();
    let target = collection.to_lowercase().replace(['_', '-'], "");
    let base = base.replace(['_', '-'], "");
    let singular = |word: &str| -> String {
        word.strip_suffix("ies")
            .map(|stem| format!("{stem}y"))
            .or_else(|| {
                word.strip_suffix("es")
                    .filter(|stem| stem.ends_with('s'))
                    .map(str::to_owned)
            })
            .or_else(|| word.strip_suffix('s').map(str::to_owned))
            .unwrap_or_else(|| word.to_owned())
    };
    let forms: HashSet<String> = [base.clone(), singular(&base)].into_iter().collect();
    forms.contains(&target) || forms.contains(&singular(&target))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn field_names_match_their_collections() {
        assert!(names_match("customerId", "customers"));
        assert!(names_match("customer_id", "customers"));
        assert!(names_match("items.productIds", "products"));
        assert!(names_match("category", "categories"));
        assert!(names_match("addressRef", "addresses"));
        assert!(names_match("user", "users"));
        assert!(!names_match("ownerId", "users"));
    }

    #[test]
    fn finds_object_id_fields_in_arrays_and_nested_documents() {
        let a = ObjectId::new();
        let b = ObjectId::new();
        let documents = vec![
            doc! { "_id": ObjectId::new(), "customerId": a, "items": [{ "productId": b }], "tags": [a, b], "n": 1 },
            doc! { "_id": ObjectId::new(), "customerId": a, "meta": { "createdBy": b } },
        ];
        let found = candidates_of("orders", &documents);
        let fields: Vec<_> = found
            .iter()
            .map(|c| (c.field.as_str(), c.many, c.ids.len()))
            .collect();
        assert_eq!(
            fields,
            [
                ("customerId", false, 1),
                ("items.productId", true, 1),
                ("meta.createdBy", false, 1),
                ("tags", true, 2),
            ]
        );
    }
}
