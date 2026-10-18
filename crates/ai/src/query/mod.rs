//! What the model is asked and what it may answer.

use bson::{Bson, Document};
use odin_core::CoreError;
use odin_core::ejson::EJsonDocument;
use serde::{Deserialize, Serialize};

mod repair;

/// Field paths and BSON type names only: no value of any document ever reaches a model.
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct FieldHint {
    pub path: String,
    pub types: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct QueryRequest {
    /// What the user typed, e.g. "active users from Italy, newest first".
    pub prompt: String,
    pub collection: String,
    pub fields: Vec<FieldHint>,
}

/// A find query, checked: it parses as BSON and uses no server-side JavaScript.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct GeneratedQuery {
    pub filter: EJsonDocument,
    pub sort: Option<EJsonDocument>,
    pub projection: Option<EJsonDocument>,
    pub limit: Option<u32>,
}

/// The longest prompt accepted; anything longer is not a query description.
pub const MAX_PROMPT_CHARS: usize = 1000;

/// Operators that run JavaScript on the server or write data; a generated query never uses them.
const FORBIDDEN: [&str; 5] = ["$where", "$function", "$accumulator", "$out", "$merge"];

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Answer {
    filter: serde_json::Value,
    #[serde(default)]
    sort: Option<serde_json::Value>,
    #[serde(default)]
    projection: Option<serde_json::Value>,
    #[serde(default)]
    limit: Option<u32>,
}

/// Turns the model's JSON answer into a query, or explains why it cannot be used.
/// `fields` repairs a common slip of small models: dates and ids written as plain strings.
pub fn parse_answer(text: &str, fields: &[FieldHint]) -> Result<GeneratedQuery, CoreError> {
    let unusable = |reason: String| {
        CoreError::Validation(format!(
            "the model's answer is not a usable query: {reason}"
        ))
    };
    let answer: Answer =
        serde_json::from_str(text.trim()).map_err(|error| unusable(error.to_string()))?;
    let document = |value: serde_json::Value, name: &str| -> Result<Document, CoreError> {
        match Bson::try_from(value).map_err(|error| unusable(error.to_string()))? {
            Bson::Document(document) => {
                if let Some(operator) = forbidden_operator(&document) {
                    return Err(unusable(format!("it uses {operator}")));
                }
                Ok(document)
            }
            _ => Err(unusable(format!("{name} is not a document"))),
        }
    };
    let optional = |value: Option<serde_json::Value>, name: &str| {
        value
            .filter(|value| !value.is_null())
            .map(|value| document(value, name))
            .transpose()
            .map(|document| {
                document
                    .filter(|document| !document.is_empty())
                    .map(Into::into)
            })
    };
    let mut filter = document(answer.filter, "filter")?;
    repair::filter(&mut filter, fields);
    Ok(GeneratedQuery {
        filter: filter.into(),
        sort: optional(answer.sort, "sort")?,
        projection: optional(answer.projection, "projection")?,
        limit: answer.limit.filter(|limit| *limit > 0),
    })
}

fn forbidden_operator(document: &Document) -> Option<&'static str> {
    document.iter().find_map(|(key, value)| {
        FORBIDDEN
            .into_iter()
            .find(|operator| key == operator)
            .or_else(|| forbidden_in(value))
    })
}

fn forbidden_in(value: &Bson) -> Option<&'static str> {
    match value {
        Bson::Document(document) => forbidden_operator(document),
        Bson::Array(items) => items.iter().find_map(forbidden_in),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_complete_answer() {
        let query = parse_answer(
            r#"{"filter": {"age": {"$gte": 30}, "createdAt": {"$gte": {"$date": "2024-01-01T00:00:00Z"}}},
                "sort": {"age": -1}, "projection": null, "limit": 10}"#,
            &[],
        )
        .unwrap();
        let filter = Document::try_from(query.filter).unwrap();
        assert!(matches!(
            filter.get_document("createdAt").unwrap().get("$gte"),
            Some(Bson::DateTime(_))
        ));
        assert_eq!(query.limit, Some(10));
        assert!(query.projection.is_none());
        assert!(query.sort.is_some());
    }

    #[test]
    fn empty_options_mean_none() {
        let query = parse_answer(r#"{"filter": {}, "sort": {}, "limit": 0}"#, &[]).unwrap();
        assert!(query.sort.is_none());
        assert!(query.limit.is_none());
    }

    #[test]
    fn rejects_server_side_javascript_anywhere() {
        for text in [
            r#"{"filter": {"$where": "this.a > 1"}}"#,
            r#"{"filter": {"$or": [{"a": 1}, {"$expr": {"$function": {"body": "x", "args": [], "lang": "js"}}}]}}"#,
        ] {
            let error = parse_answer(text, &[]).unwrap_err().to_string();
            assert!(error.contains("uses $"), "{error}");
        }
    }

    #[test]
    fn rejects_malformed_answers() {
        for text in [
            "not json",
            r#"{"filter": 3}"#,
            r#"{"filter": {}, "pipeline": []}"#,
        ] {
            assert!(parse_answer(text, &[]).is_err(), "{text}");
        }
    }
}
