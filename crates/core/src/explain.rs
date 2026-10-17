//! Query plans: how the server runs a find, summarized for the UI.

use bson::{Bson, Document, doc};
use serde::{Deserialize, Serialize};

use crate::CoreError;
use crate::connection::ConnectionHandle;
use crate::ejson::{EJsonDocument, number_of};
use crate::query::Namespace;

#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ExplainRequest {
    pub filter: EJsonDocument,
    pub projection: Option<EJsonDocument>,
    pub sort: Option<EJsonDocument>,
    pub skip: Option<u32>,
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct QueryPlan {
    /// Stages of the winning plan, from the first one that runs to the last.
    pub stages: Vec<String>,
    /// Indexes the winning plan reads.
    pub indexes: Vec<String>,
    /// The plan reads every document of the collection.
    pub collection_scan: bool,
    pub returned: f64,
    pub documents_examined: f64,
    pub keys_examined: f64,
    pub milliseconds: f64,
    /// The full `explain` output, for details the summary leaves out.
    pub raw: EJsonDocument,
}

/// Runs the find with `explain` at `executionStats` verbosity. The query really
/// executes on the server (that is how the counts are measured), but nothing is
/// returned or written.
pub async fn explain_find(
    handle: &ConnectionHandle,
    namespace: &Namespace,
    request: ExplainRequest,
) -> Result<QueryPlan, CoreError> {
    let collection = namespace.collection(handle)?;
    let mut find = doc! {
        "find": collection.name(),
        "filter": Document::try_from(request.filter)?,
    };
    if let Some(projection) = request.projection {
        find.insert("projection", Document::try_from(projection)?);
    }
    if let Some(sort) = request.sort {
        find.insert("sort", Document::try_from(sort)?);
    }
    if let Some(skip) = request.skip {
        find.insert("skip", i64::from(skip));
    }
    if let Some(limit) = request.limit {
        find.insert("limit", i64::from(limit));
    }
    let raw = handle
        .client
        .database(&namespace.database)
        .run_command(doc! { "explain": find, "verbosity": "executionStats" })
        .await?;
    Ok(summarize(raw))
}

fn summarize(raw: Document) -> QueryPlan {
    let planner = raw.get_document("queryPlanner").ok();
    // Since MongoDB 7.0 the slot-based engine nests the classic tree under `queryPlan`.
    let winning = planner
        .and_then(|p| p.get_document("winningPlan").ok())
        .map(|plan| plan.get_document("queryPlan").unwrap_or(plan));

    let mut stages = Vec::new();
    let mut indexes = Vec::new();
    if let Some(plan) = winning {
        walk(plan, &mut stages, &mut indexes);
    }
    // `walk` records parents before their inputs; execution order is the reverse.
    stages.reverse();

    let stats = raw.get_document("executionStats").ok();
    let number = |key: &str| stats.and_then(|s| s.get(key)).map_or(0.0, number_of);
    QueryPlan {
        collection_scan: stages.iter().any(|stage| stage == "COLLSCAN"),
        stages,
        indexes,
        returned: number("nReturned"),
        documents_examined: number("totalDocsExamined"),
        keys_examined: number("totalKeysExamined"),
        milliseconds: number("executionTimeMillis"),
        raw: EJsonDocument::from(raw),
    }
}

fn walk(plan: &Document, stages: &mut Vec<String>, indexes: &mut Vec<String>) {
    if let Ok(stage) = plan.get_str("stage") {
        stages.push(stage.to_owned());
    }
    if let Ok(index) = plan.get_str("indexName")
        && !indexes.iter().any(|known| known == index)
    {
        indexes.push(index.to_owned());
    }
    if let Ok(input) = plan.get_document("inputStage") {
        walk(input, stages, indexes);
    }
    if let Ok(inputs) = plan.get_array("inputStages") {
        for input in inputs {
            if let Bson::Document(input) = input {
                walk(input, stages, indexes);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn summarizes_an_index_scan() {
        let plan = summarize(doc! {
            "queryPlanner": { "winningPlan": {
                "stage": "FETCH",
                "inputStage": { "stage": "IXSCAN", "indexName": "age_1" },
            } },
            "executionStats": {
                "nReturned": 12, "totalDocsExamined": 12_i64,
                "totalKeysExamined": 12, "executionTimeMillis": 1,
            },
        });
        assert_eq!(plan.stages, ["IXSCAN", "FETCH"]);
        assert_eq!(plan.indexes, ["age_1"]);
        assert!(!plan.collection_scan);
        assert!((plan.documents_examined - 12.0).abs() < f64::EPSILON);
    }

    #[test]
    fn reads_the_slot_based_engine_layout() {
        let plan = summarize(doc! {
            "queryPlanner": { "winningPlan": { "queryPlan": { "stage": "COLLSCAN" } } },
            "executionStats": { "nReturned": 0, "totalDocsExamined": 500 },
        });
        assert_eq!(plan.stages, ["COLLSCAN"]);
        assert!(plan.collection_scan);
        assert_eq!(plan.indexes, Vec::<String>::new());
    }

    #[test]
    fn follows_every_branch_of_an_or() {
        let plan = summarize(doc! {
            "queryPlanner": { "winningPlan": {
                "stage": "SUBPLAN",
                "inputStage": { "stage": "OR", "inputStages": [
                    { "stage": "IXSCAN", "indexName": "a_1" },
                    { "stage": "IXSCAN", "indexName": "b_1" },
                ] },
            } },
        });
        assert_eq!(plan.indexes, ["a_1", "b_1"]);
    }
}
