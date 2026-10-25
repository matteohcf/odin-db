//! Query plans: how the server runs a find, summarized for the UI.

use bson::{Bson, Document, doc};
use serde::{Deserialize, Serialize};

use crate::CoreError;
use crate::connection::ConnectionHandle;
use crate::ejson::{EJsonDocument, number_of};
use crate::query::{Namespace, QueryOptions};

#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ExplainRequest {
    pub filter: EJsonDocument,
    pub projection: Option<EJsonDocument>,
    pub sort: Option<EJsonDocument>,
    pub skip: Option<u32>,
    pub limit: Option<u32>,
    #[serde(default)]
    pub options: QueryOptions,
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
    /// The winning plan as a tree, root first, with what each stage did when the
    /// classic engine reports it.
    pub steps: Vec<PlanStep>,
    /// How many candidate plans the planner compared.
    pub plans_considered: u32,
    /// For a pipeline, the stages that run after the query part, in order, with what each
    /// returned; empty for a find, or when the whole pipeline runs inside the query.
    #[serde(default)]
    pub pipeline: Vec<PlanStep>,
    /// The full `explain` output, for details the summary leaves out.
    pub raw: EJsonDocument,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct PlanStep {
    pub stage: String,
    /// 0 for the root; inputs are one deeper than the stage they feed.
    pub depth: u32,
    pub returned: Option<f64>,
    /// The server's estimate of the time spent in this stage and its inputs.
    pub milliseconds: Option<f64>,
    pub documents_examined: Option<f64>,
    pub keys_examined: Option<f64>,
    pub index_name: Option<String>,
    pub key_pattern: Option<EJsonDocument>,
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
    request.options.add_to(&mut find)?;
    let raw = handle
        .client
        .database(&namespace.database)
        .run_command(doc! { "explain": find, "verbosity": "executionStats" })
        .await?;
    Ok(summarize(raw))
}

/// Runs the pipeline with `explain` at `executionStats` verbosity. Like a find, it really
/// executes, so pipelines that write (`$out`, `$merge`) are refused.
pub async fn explain_aggregate(
    handle: &ConnectionHandle,
    namespace: &Namespace,
    pipeline: Vec<EJsonDocument>,
    options: &QueryOptions,
) -> Result<QueryPlan, CoreError> {
    let pipeline = pipeline
        .into_iter()
        .map(Document::try_from)
        .collect::<Result<Vec<_>, _>>()?;
    if pipeline
        .iter()
        .any(|stage| stage.contains_key("$out") || stage.contains_key("$merge"))
    {
        return Err(CoreError::Validation(
            "pipelines with $out or $merge cannot be explained: explaining runs them".into(),
        ));
    }
    let collection = namespace.collection(handle)?;
    let mut aggregate = doc! {
        "aggregate": collection.name(),
        "pipeline": pipeline,
        "cursor": {},
    };
    options.add_to(&mut aggregate)?;
    let raw = handle
        .client
        .database(&namespace.database)
        .run_command(doc! { "explain": aggregate, "verbosity": "executionStats" })
        .await?;
    Ok(summarize_aggregate(raw))
}

/// A pipeline's explain: either one plan (the whole pipeline ran inside the query), or a
/// `$cursor` stage holding the query's plan followed by the stages run on its output.
fn summarize_aggregate(raw: Document) -> QueryPlan {
    let Ok(stages) = raw.get_array("stages") else {
        return summarize(raw);
    };
    let stages: Vec<&Document> = stages.iter().filter_map(Bson::as_document).collect();
    let cursor = stages
        .first()
        .and_then(|stage| stage.get_document("$cursor").ok())
        .cloned();
    let after = usize::from(cursor.is_some());
    let mut plan = summarize(cursor.unwrap_or_default());
    plan.pipeline = stages
        .iter()
        .skip(after)
        .map(|stage| {
            let number = |key: &str| stage.get(key).map(number_of);
            PlanStep {
                stage: stage
                    .keys()
                    .find(|key| key.starts_with('$'))
                    .cloned()
                    .unwrap_or_else(|| "?".into()),
                depth: 0,
                returned: number("nReturned"),
                milliseconds: number("executionTimeMillisEstimate"),
                documents_examined: None,
                keys_examined: None,
                index_name: None,
                key_pattern: None,
            }
        })
        .collect();
    if let Some(last) = plan.pipeline.last() {
        if let Some(returned) = last.returned {
            plan.returned = returned;
        }
        // Estimates are cumulative: the last stage's covers the whole pipeline.
        if let Some(milliseconds) = last.milliseconds {
            plan.milliseconds = plan.milliseconds.max(milliseconds);
        }
    }
    plan.raw = EJsonDocument::from(raw);
    plan
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
    // The slot-based engine reports its own stages in `executionStages`; then only the
    // plan's shape is shown, without per-stage numbers.
    let classic = planner
        .and_then(|p| p.get_document("winningPlan").ok())
        .is_some_and(|plan| !plan.contains_key("queryPlan"));
    let tree = if classic {
        stats
            .and_then(|s| s.get_document("executionStages").ok())
            .or(winning)
    } else {
        winning
    };
    let mut steps = Vec::new();
    if let Some(tree) = tree {
        collect_steps(tree, 0, &mut steps);
    }
    let rejected = planner
        .and_then(|p| p.get_array("rejectedPlans").ok())
        .map_or(0, Vec::len);
    let number = |key: &str| stats.and_then(|s| s.get(key)).map_or(0.0, number_of);
    QueryPlan {
        collection_scan: stages.iter().any(|stage| stage == "COLLSCAN"),
        stages,
        indexes,
        returned: number("nReturned"),
        documents_examined: number("totalDocsExamined"),
        keys_examined: number("totalKeysExamined"),
        milliseconds: number("executionTimeMillis"),
        steps,
        plans_considered: u32::try_from(rejected + 1).unwrap_or(u32::MAX),
        pipeline: Vec::new(),
        raw: EJsonDocument::from(raw),
    }
}

fn collect_steps(stage: &Document, depth: u32, steps: &mut Vec<PlanStep>) {
    let number = |key: &str| stage.get(key).map(number_of);
    steps.push(PlanStep {
        stage: stage.get_str("stage").unwrap_or("?").to_owned(),
        depth,
        returned: number("nReturned"),
        milliseconds: number("executionTimeMillisEstimate"),
        documents_examined: number("docsExamined"),
        keys_examined: number("keysExamined"),
        index_name: stage.get_str("indexName").ok().map(str::to_owned),
        key_pattern: stage
            .get_document("keyPattern")
            .ok()
            .cloned()
            .map(EJsonDocument::from),
    });
    let inputs = [
        "inputStage",
        "outerStage",
        "innerStage",
        "thenStage",
        "elseStage",
    ]
    .into_iter()
    .filter_map(|key| stage.get_document(key).ok())
    .chain(
        stage
            .get_array("inputStages")
            .into_iter()
            .flatten()
            .filter_map(Bson::as_document),
    );
    for input in inputs {
        collect_steps(input, depth + 1, steps);
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
    fn steps_carry_each_stage_numbers_root_first() {
        let plan = summarize(doc! {
            "queryPlanner": {
                "winningPlan": { "stage": "FETCH", "inputStage": { "stage": "IXSCAN" } },
                "rejectedPlans": [{ "stage": "COLLSCAN" }],
            },
            "executionStats": { "executionStages": {
                "stage": "FETCH", "nReturned": 5, "docsExamined": 5, "executionTimeMillisEstimate": 2,
                "inputStage": {
                    "stage": "IXSCAN", "nReturned": 5, "keysExamined": 6,
                    "indexName": "age_1", "keyPattern": { "age": 1 },
                },
            } },
        });
        assert_eq!(plan.plans_considered, 2);
        let [fetch, scan] = plan.steps.as_slice() else {
            panic!("two steps")
        };
        assert_eq!(
            (fetch.stage.as_str(), fetch.depth, fetch.documents_examined),
            ("FETCH", 0, Some(5.0))
        );
        assert_eq!((scan.depth, scan.keys_examined), (1, Some(6.0)));
        assert_eq!(scan.index_name.as_deref(), Some("age_1"));
    }

    #[test]
    fn a_split_pipeline_keeps_the_query_plan_and_lists_the_later_stages() {
        let plan = summarize_aggregate(doc! { "stages": [
            { "$cursor": {
                "queryPlanner": { "winningPlan": { "stage": "COLLSCAN" } },
                "executionStats": { "nReturned": 100, "totalDocsExamined": 500, "executionTimeMillis": 3 },
            }, "nReturned": 100_i64, "executionTimeMillisEstimate": 3_i64 },
            { "$group": { "_id": "$city" }, "nReturned": 7_i64, "executionTimeMillisEstimate": 5_i64 },
            { "$sort": { "sortKey": { "_id": 1 } }, "nReturned": 7_i64, "executionTimeMillisEstimate": 6_i64 },
        ] });
        assert!(plan.collection_scan);
        assert_eq!(plan.documents_examined, 500.0);
        let names: Vec<_> = plan.pipeline.iter().map(|s| s.stage.as_str()).collect();
        assert_eq!(names, ["$group", "$sort"]);
        assert_eq!((plan.returned, plan.milliseconds), (7.0, 6.0));
        // A pipeline that ran entirely inside the query reads like a find.
        let pushed = summarize_aggregate(doc! {
            "queryPlanner": { "winningPlan": { "stage": "IXSCAN", "indexName": "a_1" } },
        });
        assert_eq!(pushed.indexes, ["a_1"]);
        assert_eq!(pushed.pipeline.len(), 0);
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
