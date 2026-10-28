//! Accuracy of the catalog models on `eval/cases.jsonl` (ADR-0040). Downloads the models it
//! needs, so it is ignored by default:
//!
//! ODIN_AI_EVAL_MODELS=qwen2.5-coder-1.5b,qwen3.5-2b cargo test -p odin-ai --release \
//!     --test eval -- --ignored --nocapture

#![allow(clippy::unwrap_used)]
#![expect(
    clippy::wildcard_enum_match_arm,
    reason = "test code matching serde_json and BSON values"
)]

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::time::Instant;

use bson::{Bson, Document};
use odin_ai::catalog;
use odin_ai::engine::local::LocalEngine;
use odin_ai::prompt::system_prompt;
use odin_ai::query::{FieldHint, GeneratedQuery, QueryRequest, parse_answer};
use odin_ai::store::ModelStore;
use serde_json::Value;
use tokio_util::sync::CancellationToken;

#[derive(serde::Deserialize)]
struct Case {
    c: String,
    p: String,
    e: Value,
    /// Equivalent answers that also count as correct.
    #[serde(default)]
    a: Vec<Value>,
}

#[tokio::test]
#[ignore = "downloads models and runs them; minutes per model"]
async fn eval() {
    let schemas: BTreeMap<String, Vec<(String, String)>> =
        serde_json::from_str(include_str!("eval/schemas.json")).unwrap();
    let cases: Vec<Case> = include_str!("eval/cases.jsonl")
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    let dir = std::env::var("ODIN_AI_MODELS_DIR").unwrap_or_else(|_| "/tmp/odin-models".into());
    let store = ModelStore::new(PathBuf::from(dir));
    let models =
        std::env::var("ODIN_AI_EVAL_MODELS").unwrap_or_else(|_| "qwen2.5-coder-1.5b".into());
    let only = std::env::var("ODIN_AI_EVAL_ONLY").ok();

    for id in models.split(',') {
        let spec = catalog::find(id.trim()).unwrap();
        if store.installed_path(spec).is_none() {
            eprintln!("downloading {}…", spec.name);
            let (progress, _rx) = tokio::sync::mpsc::channel(1);
            store
                .download(spec, progress, CancellationToken::new())
                .await
                .unwrap();
        }
        let path = store.installed_path(spec).unwrap();
        let engine = LocalEngine::default();
        let (mut passed, mut total) = (0, 0);
        let started = Instant::now();
        for case in &cases {
            if only.as_deref().is_some_and(|only| !case.p.contains(only)) {
                continue;
            }
            total += 1;
            let request = QueryRequest {
                prompt: case.p.clone(),
                collection: case.c.clone(),
                fields: schemas[&case.c]
                    .iter()
                    .map(|(path, types)| FieldHint {
                        path: path.clone(),
                        types: types.split(" | ").map(Into::into).collect(),
                    })
                    .collect(),
            };
            let system = system_prompt(&request, "2026-10-18");
            let answer = engine
                .complete(
                    path.clone(),
                    system,
                    format!("Request: {}", case.p),
                    CancellationToken::new(),
                )
                .await
                .unwrap();
            let accepted: Vec<Value> = std::iter::once(&case.e)
                .chain(&case.a)
                .map(|value| normalize(&expected(value)))
                .collect();
            match parse_answer(&answer, &request.fields) {
                Ok(query) if accepted.contains(&normalize(&query)) => passed += 1,
                Ok(_) => eprintln!("  ✗ {}: {}", case.p, answer.trim()),
                Err(error) => eprintln!("  ! {}: {error} — {}", case.p, answer.trim()),
            }
        }
        eprintln!(
            "{}: {passed}/{total} ({:.0}%), {:.2}s per query",
            spec.name,
            f64::from(passed) * 100.0 / f64::from(total),
            started.elapsed().as_secs_f64() / f64::from(total)
        );
    }
}

fn expected(value: &Value) -> GeneratedQuery {
    let mut answer = serde_json::json!({ "sort": null, "projection": null, "limit": null });
    for (key, value) in value.as_object().unwrap() {
        answer[key] = value.clone();
    }
    parse_answer(&answer.to_string(), &[]).unwrap()
}

/// Numbers compare by value whatever their BSON type, and regex options are ignored.
fn normalize(query: &GeneratedQuery) -> Value {
    let document = |value: &odin_core::ejson::EJsonDocument| {
        let document = Document::try_from(value.clone()).unwrap();
        loosen(Bson::Document(document).into_relaxed_extjson())
    };
    serde_json::json!({
        "filter": document(&query.filter),
        "sort": query.sort.as_ref().map(document),
        "projection": query.projection.as_ref().map(document),
        "limit": query.limit,
    })
}

fn loosen(value: Value) -> Value {
    match value {
        Value::Number(number) => serde_json::json!(number.as_f64()),
        Value::Array(items) => Value::Array(items.into_iter().map(loosen).collect()),
        // `{"$eq": x}` means `x`.
        Value::Object(map) if map.len() == 1 && map.contains_key("$eq") => loosen(
            map.into_iter()
                .next()
                .map(|(_, value)| value)
                .unwrap_or_default(),
        ),
        Value::Object(map) => Value::Object(
            map.into_iter()
                .filter(|(key, _)| key != "$options")
                .map(|(key, value)| (key, loosen(value)))
                .collect(),
        ),
        other => other,
    }
}
