//! Two databases side by side, structurally: which collections, fields, indexes and validation
//! rules differ (ADR-0045). Documents are compared by `compare`; this compares their shape.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::sync::{Semaphore, mpsc};
use tokio::task::JoinSet;
use tokio_util::sync::CancellationToken;

use crate::CoreError;
use crate::browse::{CollectionKind, list_collections};
use crate::connection::ConnectionHandle;
use crate::indexes::{self, IndexInfo};
use crate::query::Namespace;
use crate::schema::{FieldSummary, sample_fields_of};
use crate::validation::{ValidationRules, get_rules};

const SAMPLE_SIZE: u32 = 200;
const CONCURRENCY: usize = 4;
/// Fields rarer than this on the side that has them are sampling noise, not a difference.
const MIN_FREQUENCY: f64 = 0.05;

#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct SchemaCompareRequest {
    pub left_database: String,
    pub right_database: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum Presence {
    Both,
    LeftOnly,
    RightOnly,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct SchemaComparison {
    pub collections: Vec<CollectionComparison>,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct CollectionComparison {
    pub name: String,
    pub presence: Presence,
    /// Fields missing on one side or holding other types; only differences are listed.
    pub fields: Vec<FieldDifference>,
    /// Indexes missing on one side or built with other options; only differences are listed.
    pub indexes: Vec<IndexDifference>,
    /// Both sides' rules, when they differ.
    pub validation: Option<ValidationDifference>,
    /// Why one side could not be read (e.g. not authorized).
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct FieldDifference {
    pub path: String,
    /// Types seen on each side; empty where the field was not seen.
    pub left_types: Vec<String>,
    pub right_types: Vec<String>,
    /// Share of sampled documents that have it, on each side.
    pub left_frequency: f64,
    pub right_frequency: f64,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct IndexDifference {
    /// The same keys on both sides: they are one index, whatever each side calls it.
    pub left: Option<IndexInfo>,
    pub right: Option<IndexInfo>,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ValidationDifference {
    pub left: ValidationRules,
    pub right: ValidationRules,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct SchemaCompareProgress {
    pub done: f64,
    pub total: f64,
}

/// What one side holds for one collection.
struct Side {
    fields: Vec<FieldSummary>,
    indexes: Vec<IndexInfo>,
    validation: Option<ValidationRules>,
}

pub async fn compare_schemas(
    left: &Arc<ConnectionHandle>,
    right: &Arc<ConnectionHandle>,
    request: SchemaCompareRequest,
    progress: mpsc::Sender<SchemaCompareProgress>,
    cancel: CancellationToken,
) -> Result<SchemaComparison, CoreError> {
    tokio::select! {
        biased;
        () = cancel.cancelled() => Err(CoreError::Cancelled),
        result = run(left, right, request, &progress) => result,
    }
}

async fn run(
    left: &Arc<ConnectionHandle>,
    right: &Arc<ConnectionHandle>,
    request: SchemaCompareRequest,
    progress: &mpsc::Sender<SchemaCompareProgress>,
) -> Result<SchemaComparison, CoreError> {
    let collections_of = |handle: &Arc<ConnectionHandle>, database: &str| {
        let handle = Arc::clone(handle);
        let database = database.to_owned();
        async move {
            Ok::<_, CoreError>(
                list_collections(&handle, &database)
                    .await?
                    .into_iter()
                    .filter(|info| !info.name.starts_with("system."))
                    .map(|info| (info.name, info.kind))
                    .collect::<BTreeMap<_, _>>(),
            )
        }
    };
    let left_names = collections_of(left, &request.left_database).await?;
    let right_names = collections_of(right, &request.right_database).await?;
    let names: BTreeSet<&String> = left_names.keys().chain(right_names.keys()).collect();
    #[allow(clippy::cast_precision_loss)]
    let total = names.len() as f64;
    let mut done = 0.0;
    let _ = progress.try_send(SchemaCompareProgress { done, total });

    let permits = Arc::new(Semaphore::new(CONCURRENCY));
    let mut tasks = JoinSet::new();
    for name in names {
        let presence = match (left_names.get(name), right_names.get(name)) {
            (Some(_), Some(_)) => Presence::Both,
            (Some(_), None) => Presence::LeftOnly,
            _ => Presence::RightOnly,
        };
        let is_view = |kind: Option<&CollectionKind>| kind == Some(&CollectionKind::View);
        let views = is_view(left_names.get(name)) || is_view(right_names.get(name));
        // Same name, but a view on one side and a collection on the other: say so rather than
        // let it pass as identical.
        let kinds_differ = presence == Presence::Both
            && is_view(left_names.get(name)) != is_view(right_names.get(name));
        // Each side is sampled as what it is there: a time series on one side is capped there.
        let kinds = (
            left_names
                .get(name)
                .copied()
                .unwrap_or(CollectionKind::View),
            right_names
                .get(name)
                .copied()
                .unwrap_or(CollectionKind::View),
        );
        let (left, right) = (Arc::clone(left), Arc::clone(right));
        let (left_db, right_db) = (
            request.left_database.clone(),
            request.right_database.clone(),
        );
        let name = name.clone();
        let permits = Arc::clone(&permits);
        tasks.spawn(async move {
            let _permit = permits.acquire_owned().await;
            if presence != Presence::Both || views {
                return CollectionComparison {
                    name,
                    presence,
                    fields: Vec::new(),
                    indexes: Vec::new(),
                    validation: None,
                    error: kinds_differ
                        .then(|| "a view on one side and a collection on the other".to_owned()),
                };
            }
            let sides = tokio::try_join!(
                read(&left, &left_db, &name, kinds.0),
                read(&right, &right_db, &name, kinds.1)
            );
            match sides {
                Ok((left, right)) => compare_sides(name, &left, &right),
                Err(error) => CollectionComparison {
                    name,
                    presence,
                    fields: Vec::new(),
                    indexes: Vec::new(),
                    validation: None,
                    error: Some(error.to_string()),
                },
            }
        });
    }
    let mut collections = Vec::new();
    while let Some(joined) = tasks.join_next().await {
        collections.push(joined.map_err(|error| CoreError::Internal(error.to_string()))?);
        done += 1.0;
        let _ = progress.try_send(SchemaCompareProgress { done, total });
    }
    collections.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(SchemaComparison { collections })
}

async fn read(
    handle: &ConnectionHandle,
    database: &str,
    collection: &str,
    kind: CollectionKind,
) -> Result<Side, CoreError> {
    let namespace = Namespace {
        database: database.to_owned(),
        collection: collection.to_owned(),
    };
    Ok(Side {
        fields: sample_fields_of(handle, &namespace, kind, SAMPLE_SIZE, None).await?,
        indexes: indexes::list(handle, &namespace).await?,
        // Rules need listCollections on the database, which some users lack: not a failure.
        validation: get_rules(handle, &namespace).await.ok(),
    })
}

fn compare_sides(name: String, left: &Side, right: &Side) -> CollectionComparison {
    CollectionComparison {
        name,
        presence: Presence::Both,
        fields: field_differences(&left.fields, &right.fields),
        indexes: index_differences(&left.indexes, &right.indexes),
        validation: match (&left.validation, &right.validation) {
            (Some(l), Some(r)) if l != r => Some(ValidationDifference {
                left: l.clone(),
                right: r.clone(),
            }),
            _ => None,
        },
        error: None,
    }
}

fn field_differences(left: &[FieldSummary], right: &[FieldSummary]) -> Vec<FieldDifference> {
    let by_path = |fields: &[FieldSummary]| -> BTreeMap<String, (BTreeSet<String>, f64)> {
        fields
            .iter()
            .map(|field| {
                // A type in a sliver of one sample is noise, not a difference in the schema.
                let types = field
                    .types
                    .iter()
                    .zip(field.type_shares.iter().chain(std::iter::repeat(&1.0)))
                    .filter(|(_, share)| **share >= MIN_FREQUENCY)
                    .map(|(kind, _)| kind.clone())
                    .collect();
                (field.path.clone(), (types, field.frequency))
            })
            .collect()
    };
    let (left, right) = (by_path(left), by_path(right));
    let paths: BTreeSet<&String> = left.keys().chain(right.keys()).collect();
    paths
        .into_iter()
        .filter_map(|path| {
            let l = left.get(path);
            let r = right.get(path);
            let differs = match (l, r) {
                (Some((lt, _)), Some((rt, _))) => lt != rt,
                (Some((_, frequency)), None) | (None, Some((_, frequency))) => {
                    *frequency >= MIN_FREQUENCY
                }
                (None, None) => false,
            };
            differs.then(|| FieldDifference {
                path: path.clone(),
                left_types: l
                    .map(|(types, _)| types.iter().cloned().collect())
                    .unwrap_or_default(),
                right_types: r
                    .map(|(types, _)| types.iter().cloned().collect())
                    .unwrap_or_default(),
                left_frequency: l.map_or(0.0, |(_, frequency)| *frequency),
                right_frequency: r.map_or(0.0, |(_, frequency)| *frequency),
            })
        })
        .collect()
}

/// Indexes are matched by their keys, in order, preferring one with the same options (two
/// indexes can share keys with different partial filters); a pair differs when options do.
fn index_differences(left: &[IndexInfo], right: &[IndexInfo]) -> Vec<IndexDifference> {
    let key_of = |index: &IndexInfo| serde_json::to_string(&index.keys).unwrap_or_default();
    let mut differences = Vec::new();
    for l in left {
        let same_keys: Vec<&IndexInfo> = right.iter().filter(|r| key_of(r) == key_of(l)).collect();
        if same_keys.iter().any(|r| same_options(l, r)) {
            continue;
        }
        differences.push(IndexDifference {
            left: Some(l.clone()),
            right: same_keys.first().map(|r| (*r).clone()),
        });
    }
    for r in right {
        if !left.iter().any(|l| key_of(l) == key_of(r)) {
            differences.push(IndexDifference {
                left: None,
                right: Some(r.clone()),
            });
        }
    }
    differences
}

fn same_options(left: &IndexInfo, right: &IndexInfo) -> bool {
    left.unique == right.unique
        && left.sparse == right.sparse
        && left.hidden == right.hidden
        && left.expire_after_seconds == right.expire_after_seconds
        && left.partial_filter == right.partial_filter
        && left.collation == right.collation
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ejson::EJsonDocument;

    fn field(path: &str, types: &[&str], frequency: f64) -> FieldSummary {
        FieldSummary {
            path: path.into(),
            types: types.iter().map(|t| (*t).to_owned()).collect(),
            type_shares: vec![1.0; types.len()],
            frequency,
            values: Vec::new(),
            range: None,
        }
    }

    fn index(name: &str, keys: bson::Document, unique: bool) -> IndexInfo {
        IndexInfo {
            name: name.into(),
            keys: EJsonDocument::from(keys),
            unique,
            sparse: false,
            hidden: false,
            expire_after_seconds: None,
            partial_filter: None,
            collation: None,
            definition: EJsonDocument::from(bson::doc! {}),
            size: None,
            usage_count: None,
            usage_since: None,
        }
    }

    #[test]
    fn lists_missing_fields_and_type_changes_but_not_rare_ones() {
        let left = [
            field("_id", &["objectId"], 1.0),
            field("age", &["int"], 1.0),
            field("nick", &["string"], 0.01),
        ];
        let right = [
            field("_id", &["objectId"], 1.0),
            field("age", &["string", "int"], 1.0),
            field("email", &["string"], 0.9),
        ];
        let paths: Vec<_> = field_differences(&left, &right)
            .into_iter()
            .map(|d| d.path)
            .collect();
        assert_eq!(paths, ["age", "email"]);
    }

    #[test]
    fn a_type_in_a_sliver_of_the_sample_is_not_a_difference() {
        let left = [field("age", &["int"], 1.0)];
        let right = [FieldSummary {
            type_shares: vec![0.98, 0.02],
            ..field("age", &["int", "string"], 1.0)
        }];
        assert_eq!(field_differences(&left, &right).len(), 0);
    }

    #[test]
    fn matches_indexes_by_keys_and_flags_other_options() {
        let left = [
            index("_id_", bson::doc! { "_id": 1 }, false),
            index("email_1", bson::doc! { "email": 1 }, true),
            index("status_1", bson::doc! { "status": 1 }, false),
        ];
        let right = [
            index("_id_", bson::doc! { "_id": 1 }, false),
            index("email_idx", bson::doc! { "email": 1 }, false),
            index("created_-1", bson::doc! { "created": -1 }, false),
        ];
        let differences = index_differences(&left, &right);
        let shape: Vec<_> = differences
            .iter()
            .map(|d| {
                (
                    d.left.as_ref().map(|i| i.name.as_str()),
                    d.right.as_ref().map(|i| i.name.as_str()),
                )
            })
            .collect();
        assert_eq!(
            shape,
            [
                (Some("email_1"), Some("email_idx")),
                (Some("status_1"), None),
                (None, Some("created_-1"))
            ]
        );
    }

    #[test]
    fn pairs_indexes_with_the_same_keys_by_their_options() {
        let partial = |name: &str, status: &str| IndexInfo {
            partial_filter: Some(EJsonDocument::from(bson::doc! { "status": status })),
            ..index(name, bson::doc! { "email": 1 }, false)
        };
        let left = [partial("active", "active"), partial("paid", "paid")];
        let right = [partial("paid_r", "paid"), partial("active_r", "active")];
        assert_eq!(index_differences(&left, &right).len(), 0);
    }

    #[test]
    fn a_different_collation_is_a_difference() {
        let caseless = |name: &str, strength: i32| IndexInfo {
            collation: Some(EJsonDocument::from(
                bson::doc! { "locale": "en", "strength": strength },
            )),
            ..index(name, bson::doc! { "name": 1 }, false)
        };
        let same = index_differences(&[caseless("a", 2)], &[caseless("b", 2)]);
        assert_eq!(same.len(), 0);
        let differs = index_differences(&[caseless("a", 2)], &[caseless("b", 3)]);
        assert_eq!(differs.len(), 1);
        let simple = index_differences(
            &[caseless("a", 2)],
            &[index("b", bson::doc! { "name": 1 }, false)],
        );
        assert_eq!(simple.len(), 1);
    }
}
