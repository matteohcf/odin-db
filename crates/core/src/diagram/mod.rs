//! A database's collections and the references between them, inferred from sampled documents
//! (ADR-0043).

use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;

use bson::oid::ObjectId;
use bson::{Bson, Document, doc};
use mongodb::options::{CollectionOptions, ReadPreference, SelectionCriteria};
use serde::{Deserialize, Serialize};
use tokio::sync::{Semaphore, mpsc};
use tokio::task::JoinSet;
use tokio_util::sync::CancellationToken;

use crate::CoreError;
use crate::browse::{CollectionKind, list_collections};
use crate::connection::ConnectionHandle;
use crate::schema::{FieldSummary, summarize};

pub mod scans;

/// Every query the scan sends stops on the server after this, however large the collection.
const QUERY_TIME_LIMIT: Duration = Duration::from_secs(5);
/// `_id`s per lookup query.
const LOOKUP_CHUNK: usize = 1000;
/// Fields beyond this are rarely what a diagram is read for, and make nodes unwieldy.
const MAX_FIELDS: usize = 60;
/// `ObjectId`s kept per field to look up in candidate collections.
const MAX_IDS: usize = 40;
/// Without a collection named like the field, every collection is tried only up to this size.
const MAX_BLIND_TARGETS: usize = 40;
/// `ObjectId` fields looked up at all: maps keyed by id can produce thousands of paths.
const MAX_CANDIDATES: usize = 200;
/// A reference needs at least this share of its sampled values to exist in the target.
const MIN_MATCH: f64 = 0.5;

/// How hard a scan may press on the server (ADR-0060).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum ScanPace {
    Fast,
    Balanced,
    Gentle,
}

#[derive(Debug, Clone, Copy)]
struct PaceSettings {
    concurrency: usize,
    /// After each query, per task.
    pause: Duration,
    sample_size: i64,
    /// Look up fields named after no collection in every collection.
    blind: bool,
}

impl ScanPace {
    fn settings(self) -> PaceSettings {
        let (concurrency, pause, sample_size, blind) = match self {
            Self::Fast => (4, 0, 100, true),
            Self::Balanced => (2, 100, 100, true),
            Self::Gentle => (1, 500, 50, false),
        };
        PaceSettings {
            concurrency,
            pause: Duration::from_millis(pause),
            sample_size,
            blind,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
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

#[derive(Debug, Clone, Serialize, Deserialize)]
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
    pace: ScanPace,
    progress: mpsc::Sender<DiagramProgress>,
    cancel: CancellationToken,
) -> Result<DatabaseDiagram, CoreError> {
    tokio::select! {
        biased;
        () = cancel.cancelled() => Err(CoreError::Cancelled),
        diagram = build(handle, database, pace.settings(), &progress) => diagram,
    }
}

/// The scan reads from secondaries when it can: a diagram must not load the primary.
fn scan_collection(
    handle: &ConnectionHandle,
    database: &str,
    name: &str,
) -> mongodb::Collection<Document> {
    let options = CollectionOptions::builder()
        .selection_criteria(SelectionCriteria::ReadPreference(
            ReadPreference::SecondaryPreferred { options: None },
        ))
        .build();
    handle
        .client
        .database(database)
        .collection_with_options(name, options)
}

async fn build(
    handle: &ConnectionHandle,
    database: &str,
    pace: PaceSettings,
    progress: &mpsc::Sender<DiagramProgress>,
) -> Result<DatabaseDiagram, CoreError> {
    let infos: Vec<_> = list_collections(handle, database)
        .await?
        .into_iter()
        .filter(|info| !info.name.starts_with("system."))
        .collect();
    let total = infos.len();
    let mut done = 0;
    report(progress, done, total);

    let permits = Arc::new(Semaphore::new(pace.concurrency));
    let mut tasks = JoinSet::new();
    for info in infos {
        let collection = scan_collection(handle, database, &info.name);
        let permits = Arc::clone(&permits);
        tasks.spawn(async move {
            let _permit = permits.acquire_owned().await;
            // Sampling or counting a view runs its whole pipeline: views are listed, not read.
            if info.kind == CollectionKind::View {
                return (info, 0, Ok(Vec::new()));
            }
            let sampled = sample(&collection, pace.sample_size).await;
            tokio::time::sleep(pace.pause).await;
            let documents = collection
                .estimated_document_count()
                .max_time(QUERY_TIME_LIMIT)
                .await
                .unwrap_or(0);
            tokio::time::sleep(pace.pause).await;
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
        report(progress, done, total);
    }
    collections.sort_by(|a, b| a.name.cmp(&b.name));

    let targets: Vec<&str> = collections
        .iter()
        // Views cannot be counted cheaply, and an `_id` lookup scans a time series' buckets. A
        // collection too expensive to sample stays a target: an `_id` lookup is cheap anywhere.
        .filter(|collection| collection.kind == CollectionKind::Collection)
        .map(|collection| collection.name.as_str())
        .collect();
    // Fields named after a collection first: they are the likely references.
    candidates.sort_by_key(|candidate| {
        !targets
            .iter()
            .any(|target| names_match(&candidate.field, target))
    });
    candidates.truncate(MAX_CANDIDATES);

    let links = infer_links(
        handle,
        database,
        &candidates,
        &targets,
        pace,
        progress,
        (done, total),
    )
    .await;
    Ok(DatabaseDiagram { collections, links })
}

/// Looks up the candidates' values: one lookup per target for every candidate trying it, instead
/// of one per pair.
async fn infer_links(
    handle: &ConnectionHandle,
    database: &str,
    candidates: &[Candidate],
    targets: &[&str],
    pace: PaceSettings,
    progress: &mpsc::Sender<DiagramProgress>,
    (mut done, mut total): (usize, usize),
) -> Vec<DiagramLink> {
    let tried: Vec<Vec<&str>> = candidates
        .iter()
        .map(|candidate| tried_targets(candidate, targets, pace.blind))
        .collect();
    let mut wanted: BTreeMap<&str, HashSet<ObjectId>> = BTreeMap::new();
    for (candidate, tried) in candidates.iter().zip(&tried) {
        for target in tried {
            wanted
                .entry(target)
                .or_default()
                .extend(candidate.ids.iter().copied());
        }
    }
    total += wanted.len();
    report(progress, done, total);
    let mut found = HashMap::new();
    for (target, ids) in wanted {
        let collection = scan_collection(handle, database, target);
        // A collection that cannot be read (permissions, time limit, dropped meanwhile) is no
        // target; the rest of the diagram still stands.
        if let Ok(ids) = existing_ids(&collection, ids.into_iter().collect(), pace.pause).await {
            found.insert(target, ids);
        }
        done += 1;
        report(progress, done, total);
    }
    candidates
        .iter()
        .zip(&tried)
        .filter_map(|(candidate, tried)| link_of(candidate, tried, &found))
        .collect()
}

fn report(progress: &mpsc::Sender<DiagramProgress>, done: usize, total: usize) {
    #[allow(clippy::cast_precision_loss)]
    let _ = progress.try_send(DiagramProgress {
        done: done as f64,
        total: total as f64,
    });
}

async fn sample(
    collection: &mongodb::Collection<Document>,
    size: i64,
) -> Result<Vec<Document>, CoreError> {
    let mut cursor = collection
        .aggregate([doc! { "$sample": { "size": size } }])
        .max_time(QUERY_TIME_LIMIT)
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

/// Collections named like the field; without one, every collection when blind search is on and
/// the database is small.
fn tried_targets<'a>(candidate: &Candidate, targets: &[&'a str], blind: bool) -> Vec<&'a str> {
    let named: Vec<&str> = targets
        .iter()
        .copied()
        .filter(|target| names_match(&candidate.field, target))
        .collect();
    if !named.is_empty() {
        named
    } else if blind && targets.len() <= MAX_BLIND_TARGETS {
        targets.to_vec()
    } else {
        Vec::new()
    }
}

/// Which of `ids` exist as an `_id` of the collection; an index-covered read, in chunks.
async fn existing_ids(
    collection: &mongodb::Collection<Document>,
    ids: Vec<ObjectId>,
    pause: Duration,
) -> Result<HashSet<ObjectId>, CoreError> {
    let mut found = HashSet::new();
    for chunk in ids.chunks(LOOKUP_CHUNK) {
        let mut cursor = collection
            .find(doc! { "_id": { "$in": chunk.iter().copied().map(Bson::ObjectId).collect::<Vec<_>>() } })
            .projection(doc! { "_id": 1 })
            .max_time(QUERY_TIME_LIMIT)
            .await?;
        while cursor.advance().await? {
            if let Ok(id) = cursor.current().get_object_id("_id") {
                found.insert(id);
            }
        }
        tokio::time::sleep(pause).await;
    }
    Ok(found)
}

/// The target holding most of the candidate's values, if enough of them exist there. Targets
/// missing from `found` could not be read.
fn link_of(
    candidate: &Candidate,
    tried: &[&str],
    found: &HashMap<&str, HashSet<ObjectId>>,
) -> Option<DiagramLink> {
    #[allow(clippy::cast_precision_loss)]
    let checked = candidate.ids.len() as f64;
    let mut best: Option<(f64, &str)> = None;
    for target in tried {
        let Some(existing) = found.get(target) else {
            continue;
        };
        #[allow(clippy::cast_precision_loss)]
        let matched = candidate
            .ids
            .iter()
            .filter(|id| existing.contains(id))
            .count() as f64;
        if best.is_none_or(|(most, _)| matched > most) {
            best = Some((matched, target));
        }
    }
    best.filter(|(matched, _)| *matched > 0.0 && *matched / checked >= MIN_MATCH)
        .map(|(matched, to)| DiagramLink {
            from: candidate.from.clone(),
            field: candidate.field.clone(),
            to: to.to_owned(),
            many: candidate.many,
            matched,
            checked,
        })
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

    fn candidate(field: &str, ids: &[ObjectId]) -> Candidate {
        Candidate {
            from: "orders".to_owned(),
            field: field.to_owned(),
            many: false,
            ids: ids.to_vec(),
        }
    }

    #[test]
    fn links_to_the_target_holding_most_values() {
        let ids: Vec<ObjectId> = (0..4).map(|_| ObjectId::new()).collect();
        let buyer = candidate("buyer", &ids);
        let found = HashMap::from([
            (
                "customers",
                ids[..3].iter().copied().collect::<HashSet<_>>(),
            ),
            ("users", ids[..1].iter().copied().collect()),
        ]);
        let link = link_of(&buyer, &["users", "customers"], &found).expect("a link");
        assert_eq!(
            (link.to.as_str(), link.matched, link.checked),
            ("customers", 3.0, 4.0)
        );
    }

    #[test]
    fn unreadable_targets_and_weak_matches_make_no_link() {
        let ids: Vec<ObjectId> = (0..4).map(|_| ObjectId::new()).collect();
        let buyer = candidate("buyer", &ids);
        // `customers` failed (time limit, permissions): only `users` was read, and it holds one.
        let found = HashMap::from([("users", ids[..1].iter().copied().collect::<HashSet<_>>())]);
        assert_eq!(link_of(&buyer, &["customers", "users"], &found), None);
        // The other candidates' links do not depend on the failed target.
        let owner = candidate("owner", &ids[..1]);
        assert_eq!(
            link_of(&owner, &["customers", "users"], &found).map(|link| link.to),
            Some("users".to_owned())
        );
    }

    #[test]
    fn blind_search_is_off_in_gentle_scans() {
        let buyer = candidate("buyer", &[ObjectId::new()]);
        let product = candidate("items.productId", &[ObjectId::new()]);
        let targets = ["customers", "products"];
        assert_eq!(tried_targets(&buyer, &targets, true), targets);
        assert_eq!(tried_targets(&buyer, &targets, false).len(), 0);
        assert_eq!(tried_targets(&product, &targets, false), ["products"]);
        assert!(!ScanPace::Gentle.settings().blind);
    }
}
