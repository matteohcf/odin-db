//! Index advice from the server's slow operations (ADR-0044): the query shapes that scan too
//! much, grouped, with the index that would serve them.

use std::collections::HashMap;
use std::sync::Arc;

use bson::{Bson, Document, doc};
use serde::Serialize;
use tokio::sync::Semaphore;
use tokio::task::JoinSet;

use crate::CoreError;
use crate::browse::list_databases;
use crate::connection::ConnectionHandle;
use crate::ejson::EJsonDocument;
use crate::indexes;
use crate::profiler::{self, ProfileQuery, ProfilingLevel};
use crate::query::Namespace;

/// Databases whose profiler is looked at, so a cluster with thousands stays quick.
const MAX_PROFILED_DATABASES: usize = 50;
const CONCURRENCY: usize = 8;
const MAX_ADVICE: usize = 50;
/// An index scan is inefficient past this many documents read per document returned.
const MAX_SCAN_RATIO: f64 = 100.0;
const MIN_EXAMINED: f64 = 1000.0;
const RANGE_OPERATORS: [&str; 8] = [
    "$gt", "$gte", "$lt", "$lte", "$ne", "$nin", "$regex", "$exists",
];

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct AdvisorReport {
    pub advice: Vec<IndexAdvice>,
    pub sources: Vec<AdvisorSource>,
}

/// Where slow operations were read from, and whether that worked.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct AdvisorSource {
    /// `log`, or the database whose profiler was read.
    pub name: String,
    pub operations: f64,
    /// Why it could not be read (e.g. missing privileges).
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct IndexAdvice {
    pub database: String,
    pub collection: String,
    /// The suggested index, equality fields first, then the sort, then ranges (ESR).
    pub keys: EJsonDocument,
    /// Slow operations of this shape that were seen.
    pub occurrences: f64,
    pub total_millis: f64,
    pub max_millis: f64,
    /// Average documents read and returned per operation.
    pub docs_examined: f64,
    pub returned: f64,
    /// At least one of them read the whole collection.
    pub collection_scan: bool,
    /// The filter of one of them, as an example.
    pub example: EJsonDocument,
    /// An existing index that already starts with these keys: the planner chose not to use it.
    pub existing: Option<String>,
}

/// One slow operation, reduced to what decides its index.
struct Observation {
    database: String,
    collection: String,
    filter: Document,
    sort: Option<Document>,
    millis: f64,
    examined: f64,
    returned: f64,
    collection_scan: bool,
}

pub async fn advise(handle: &Arc<ConnectionHandle>) -> Result<AdvisorReport, CoreError> {
    let mut sources = Vec::new();
    let mut observations = Vec::new();

    match slow_log(handle).await {
        Ok(found) => {
            sources.push(source("log", found.len(), None));
            observations.extend(found);
        }
        Err(error) => sources.push(source("log", 0, Some(error.to_string()))),
    }
    let (profiled, from_profiler) = profiled(handle).await;
    // The log repeats what a database's profiler records: count those operations once.
    let profiled_databases: Vec<String> = from_profiler
        .iter()
        .map(|observation| observation.database.clone())
        .collect();
    observations.retain(|observation| !profiled_databases.contains(&observation.database));
    sources.extend(profiled);
    observations.extend(from_profiler);

    let mut groups: HashMap<String, Vec<Observation>> = HashMap::new();
    for observation in observations
        .into_iter()
        .filter(|observation| observation.inefficient() && !observation.internal())
    {
        if let Some(signature) = shape(&observation) {
            groups.entry(signature).or_default().push(observation);
        }
    }
    // Only the costliest groups are shown, so only their indexes are looked up.
    let mut groups: Vec<Vec<Observation>> = groups.into_values().collect();
    let cost = |group: &Vec<Observation>| group.iter().map(|o| o.millis).sum::<f64>();
    groups.sort_by(|a, b| cost(b).total_cmp(&cost(a)));
    groups.truncate(MAX_ADVICE);

    let mut existing: HashMap<String, Vec<(String, Vec<String>)>> = HashMap::new();
    let mut advice = Vec::new();
    for group in groups {
        let Some(first) = group.first() else { continue };
        let Some(keys) = suggest_keys(&first.filter, first.sort.as_ref()) else {
            continue;
        };
        let namespace = format!("{}.{}", first.database, first.collection);
        if !existing.contains_key(&namespace) {
            let found = index_keys(handle, &first.database, &first.collection).await;
            existing.insert(namespace.clone(), found);
        }
        let fields: Vec<String> = keys.keys().cloned().collect();
        let covering = existing.get(&namespace).and_then(|indexes| {
            indexes
                .iter()
                .find(|(_, index)| {
                    index.len() >= fields.len() && index[..fields.len()] == fields[..]
                })
                .map(|(name, _)| name.clone())
        });
        #[allow(clippy::cast_precision_loss)]
        let count = group.len() as f64;
        advice.push(IndexAdvice {
            database: first.database.clone(),
            collection: first.collection.clone(),
            keys: EJsonDocument::from(keys),
            occurrences: count,
            total_millis: group.iter().map(|o| o.millis).sum(),
            max_millis: group.iter().map(|o| o.millis).fold(0.0, f64::max),
            docs_examined: group.iter().map(|o| o.examined).sum::<f64>() / count,
            returned: group.iter().map(|o| o.returned).sum::<f64>() / count,
            collection_scan: group.iter().any(|o| o.collection_scan),
            example: EJsonDocument::from(first.filter.clone()),
            existing: covering,
        });
    }
    advice.sort_by(|a, b| b.total_millis.total_cmp(&a.total_millis));
    Ok(AdvisorReport { advice, sources })
}

fn source(name: &str, operations: usize, error: Option<String>) -> AdvisorSource {
    #[allow(clippy::cast_precision_loss)]
    AdvisorSource {
        name: name.to_owned(),
        operations: operations as f64,
        error,
    }
}

impl Observation {
    /// The server's own collections (the oplog, sessions, users…): nothing to index there.
    fn internal(&self) -> bool {
        matches!(self.database.as_str(), "local" | "config" | "admin")
            || self.collection.starts_with("system.")
    }

    fn inefficient(&self) -> bool {
        self.collection_scan
            || (self.examined >= MIN_EXAMINED
                && self.examined / self.returned.max(1.0) > MAX_SCAN_RATIO)
    }
}

/// "Slow query" entries of the server's recent log (`getLog`), which needs no profiler.
async fn slow_log(handle: &ConnectionHandle) -> Result<Vec<Observation>, CoreError> {
    let reply = handle
        .client
        .database("admin")
        .run_command(doc! { "getLog": "global" })
        .await?;
    let lines = reply
        .get_array("log")
        .map_err(|error| CoreError::Internal(error.to_string()))?;
    Ok(lines
        .iter()
        .filter_map(Bson::as_str)
        .filter(|line| line.contains("\"Slow query\""))
        .filter_map(from_log_line)
        .collect())
}

fn from_log_line(line: &str) -> Option<Observation> {
    let value: serde_json::Value = serde_json::from_str(line).ok()?;
    let attr = Bson::try_from(value.get("attr")?.clone()).ok()?;
    let attr = attr.as_document()?;
    let (database, collection) = attr.get_str("ns").ok()?.split_once('.')?;
    let command = attr.get_document("command").ok()?;
    let (filter, sort) = filter_of(command)?;
    Some(Observation {
        database: database.to_owned(),
        collection: collection.to_owned(),
        filter,
        sort,
        millis: number(attr.get("durationMillis")),
        examined: number(attr.get("docsExamined")),
        returned: number(attr.get("nreturned")),
        collection_scan: attr
            .get_str("planSummary")
            .is_ok_and(|plan| plan.starts_with("COLLSCAN")),
    })
}

/// Recorded operations of every database whose profiler is on.
async fn profiled(handle: &Arc<ConnectionHandle>) -> (Vec<AdvisorSource>, Vec<Observation>) {
    let databases = match list_databases(handle).await {
        Ok(databases) => databases,
        Err(error) => {
            return (
                vec![source("profiler", 0, Some(error.to_string()))],
                Vec::new(),
            );
        }
    };
    let permits = Arc::new(Semaphore::new(CONCURRENCY));
    let mut tasks = JoinSet::new();
    for database in databases.into_iter().take(MAX_PROFILED_DATABASES) {
        let handle = Arc::clone(handle);
        let permits = Arc::clone(&permits);
        tasks.spawn(async move {
            let _permit = permits.acquire_owned().await;
            let status = match profiler::status(&handle, &database.name).await {
                Ok(status) => status,
                Err(error) => return Status::Unreadable(error.to_string()),
            };
            if matches!(status.level, ProfilingLevel::Off) {
                return Status::Off;
            }
            let entries = profiler::entries(
                &handle,
                ProfileQuery {
                    database: database.name.clone(),
                    collection: None,
                    // At level "all" the profiler also keeps fast operations: they need no index.
                    min_millis: Some(status.slow_ms),
                },
            )
            .await;
            Status::On(database.name, entries)
        });
    }
    let mut sources = Vec::new();
    let mut observations = Vec::new();
    let mut unreadable: Option<String> = None;
    let mut readable = false;
    while let Some(joined) = tasks.join_next().await {
        let (database, entries) = match joined {
            Ok(Status::On(database, entries)) => (database, entries),
            Ok(Status::Off) => {
                readable = true;
                continue;
            }
            Ok(Status::Unreadable(error)) => {
                unreadable.get_or_insert(error);
                continue;
            }
            Err(error) => {
                unreadable.get_or_insert(error.to_string());
                continue;
            }
        };
        readable = true;
        match entries {
            Ok(entries) => {
                let found: Vec<_> = entries
                    .into_iter()
                    .filter_map(|entry| {
                        let command = Document::try_from(entry.command?).ok()?;
                        let (filter, sort) = filter_of(&command)?;
                        let (db, collection) = entry.ns.split_once('.')?;
                        Some(Observation {
                            database: db.to_owned(),
                            collection: collection.to_owned(),
                            filter,
                            sort,
                            millis: entry.millis,
                            examined: entry.docs_examined.unwrap_or(0.0),
                            returned: entry.returned.unwrap_or(0.0),
                            collection_scan: entry
                                .plan_summary
                                .is_some_and(|plan| plan.starts_with("COLLSCAN")),
                        })
                    })
                    .collect();
                sources.push(source(&database, found.len(), None));
                observations.extend(found);
            }
            Err(error) => sources.push(source(&database, 0, Some(error.to_string()))),
        }
    }
    // Without the privilege to read any profiler, say so once rather than seem to have none.
    if let (false, Some(error)) = (readable, unreadable) {
        sources.push(source("profiler", 0, Some(error)));
    }
    sources.sort_by(|a, b| a.name.cmp(&b.name));
    (sources, observations)
}

enum Status {
    Off,
    On(String, Result<Vec<profiler::ProfileEntry>, CoreError>),
    Unreadable(String),
}

/// The filter (and sort) of a find, aggregate (leading `$match`), count, distinct, update or
/// delete, as both the log and the profiler record them.
fn filter_of(command: &Document) -> Option<(Document, Option<Document>)> {
    let sort = command.get_document("sort").ok().cloned();
    for key in ["filter", "query", "q"] {
        if let Ok(filter) = command.get_document(key) {
            return Some((filter.clone(), sort));
        }
    }
    for key in ["updates", "deletes"] {
        if let Some(Bson::Document(first)) =
            command.get_array(key).ok().and_then(|list| list.first())
            && let Ok(filter) = first.get_document("q")
        {
            return Some((filter.clone(), None));
        }
    }
    let pipeline = command.get_array("pipeline").ok()?;
    let stage = |index: usize, name: &str| {
        pipeline
            .get(index)
            .and_then(Bson::as_document)
            .and_then(|stage| stage.get_document(name).ok())
            .cloned()
    };
    let matched = stage(0, "$match")?;
    Some((matched, stage(1, "$sort")))
}

/// What makes two operations need the same index: their namespace, the fields compared by
/// equality and by range, and the sort.
fn shape(observation: &Observation) -> Option<String> {
    let keys = suggest_keys(&observation.filter, observation.sort.as_ref())?;
    Some(format!(
        "{}.{}|{}",
        observation.database,
        observation.collection,
        keys.iter()
            .map(|(field, dir)| format!("{field}:{dir}"))
            .collect::<Vec<_>>()
            .join(",")
    ))
}

/// Index keys following MongoDB's ESR guideline; `None` when no field could use an index.
pub(crate) fn suggest_keys(filter: &Document, sort: Option<&Document>) -> Option<Document> {
    let mut conditions: Vec<(&str, &Bson)> = Vec::new();
    collect_conditions(filter, &mut conditions);
    let mut keys = Document::new();
    for (field, value) in &conditions {
        if !is_range(value) {
            keys.insert(*field, 1);
        }
    }
    if let Some(sort) = sort {
        for (field, direction) in sort {
            // `$natural` order and `{ $meta: "textScore" }` are not index keys.
            if field.starts_with('$') || matches!(direction, Bson::Document(_)) {
                continue;
            }
            if !keys.contains_key(field) {
                keys.insert(field, if number(Some(direction)) < 0.0 { -1 } else { 1 });
            }
        }
    }
    for (field, value) in &conditions {
        if is_range(value) && !keys.contains_key(*field) {
            keys.insert(*field, 1);
        }
    }
    (!keys.is_empty()).then_some(keys)
}

/// Field conditions, looking through `$and` (`$or` branches need indexes of their own).
fn collect_conditions<'a>(filter: &'a Document, out: &mut Vec<(&'a str, &'a Bson)>) {
    for (field, value) in filter {
        if field == "$and" {
            for part in value.as_array().into_iter().flatten() {
                if let Some(part) = part.as_document() {
                    collect_conditions(part, out);
                }
            }
        } else if !field.starts_with('$') {
            out.push((field, value));
        }
    }
}

fn is_range(value: &Bson) -> bool {
    value.as_document().is_some_and(|operators| {
        operators
            .keys()
            .any(|key| RANGE_OPERATORS.contains(&key.as_str()))
    })
}

async fn index_keys(
    handle: &ConnectionHandle,
    database: &str,
    collection: &str,
) -> Vec<(String, Vec<String>)> {
    let namespace = Namespace {
        database: database.to_owned(),
        collection: collection.to_owned(),
    };
    indexes::list(handle, &namespace)
        .await
        .unwrap_or_default()
        .into_iter()
        .filter(|index| !index.hidden)
        .filter_map(|index| {
            let keys = Document::try_from(index.keys).ok()?;
            Some((index.name, keys.keys().cloned().collect()))
        })
        .collect()
}

fn number(value: Option<&Bson>) -> f64 {
    #[allow(clippy::cast_precision_loss)]
    match value {
        Some(Bson::Int32(n)) => f64::from(*n),
        Some(Bson::Int64(n)) => *n as f64,
        Some(Bson::Double(n)) => *n,
        _ => 0.0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn suggests_equality_then_sort_then_range() {
        let filter =
            doc! { "status": "paid", "total": { "$gt": 10 }, "$and": [{ "city": "Rome" }] };
        let keys = suggest_keys(&filter, Some(&doc! { "placedAt": -1 })).expect("keys");
        assert_eq!(
            keys,
            doc! { "status": 1, "city": 1, "placedAt": -1, "total": 1 }
        );
        assert!(suggest_keys(&doc! { "$or": [{ "a": 1 }] }, None).is_none());
    }

    #[test]
    fn leaves_natural_order_and_text_score_out_of_the_keys() {
        let keys = suggest_keys(
            &doc! { "status": "paid" },
            Some(&doc! { "$natural": 1, "score": { "$meta": "textScore" }, "placedAt": -1 }),
        )
        .expect("keys");
        assert_eq!(keys, doc! { "status": 1, "placedAt": -1 });
    }

    #[test]
    fn the_servers_own_collections_are_not_advised() {
        let observation = |database: &str, collection: &str| Observation {
            database: database.into(),
            collection: collection.into(),
            filter: doc! {},
            sort: None,
            millis: 0.0,
            examined: 0.0,
            returned: 0.0,
            collection_scan: true,
        };
        assert!(observation("local", "oplog.rs").internal());
        assert!(observation("shop", "system.views").internal());
        assert!(!observation("shop", "orders").internal());
    }

    #[test]
    fn reads_filters_from_every_command_kind() {
        let find = doc! { "find": "users", "filter": { "email": "a" }, "sort": { "name": 1 } };
        assert_eq!(
            filter_of(&find),
            Some((doc! { "email": "a" }, Some(doc! { "name": 1 })))
        );
        let aggregate = doc! { "aggregate": "orders", "pipeline": [{ "$match": { "s": 1 } }, { "$sort": { "t": -1 } }] };
        assert_eq!(
            filter_of(&aggregate),
            Some((doc! { "s": 1 }, Some(doc! { "t": -1 })))
        );
        let update = doc! { "update": "orders", "updates": [{ "q": { "n": 3 }, "u": {} }] };
        assert_eq!(filter_of(&update), Some((doc! { "n": 3 }, None)));
        assert_eq!(filter_of(&doc! { "insert": "x" }), None);
    }

    #[test]
    fn parses_a_slow_query_log_line() {
        let line = r#"{"t":{"$date":"2026-10-24T10:00:00.000+00:00"},"s":"I","c":"COMMAND","id":51803,"msg":"Slow query","attr":{"type":"command","ns":"shop.orders","command":{"find":"orders","filter":{"status":"paid"},"$db":"shop"},"planSummary":"COLLSCAN","docsExamined":120000,"nreturned":12,"durationMillis":340}}"#;
        let observation = from_log_line(line).expect("parsed");
        assert_eq!(
            (
                observation.database.as_str(),
                observation.collection.as_str()
            ),
            ("shop", "orders")
        );
        assert!(observation.collection_scan && observation.inefficient());
        assert_eq!(observation.millis, 340.0);
        assert_eq!(observation.filter, doc! { "status": "paid" });
    }
}
