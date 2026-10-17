//! Field paths sampled from a collection, for query autocompletion.

use std::collections::HashMap;

use bson::{Bson, Document, doc};
use serde::Serialize;

use crate::CoreError;
use crate::connection::ConnectionHandle;
use crate::query::Namespace;

pub const MAX_SAMPLE_SIZE: u32 = 1000;
/// Deeper paths are rare in queries and would make wide documents explode.
const MAX_DEPTH: usize = 6;
const MAX_FIELDS: usize = 1000;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct FieldSummary {
    /// Dot notation, as used in queries: fields of documents inside arrays
    /// share the array's path (`items.sku`).
    pub path: String,
    /// BSON type names seen for this path, most frequent first.
    pub types: Vec<String>,
    /// Share of sampled documents that contain the path, from 0 to 1.
    pub frequency: f64,
}

/// Samples up to `size` documents and summarizes their field paths, most common first.
pub async fn sample_fields(
    handle: &ConnectionHandle,
    namespace: &Namespace,
    size: u32,
) -> Result<Vec<FieldSummary>, CoreError> {
    if size == 0 || size > MAX_SAMPLE_SIZE {
        return Err(CoreError::Validation(format!(
            "sample size must be between 1 and {MAX_SAMPLE_SIZE}"
        )));
    }
    let mut cursor = namespace
        .collection(handle)?
        .aggregate([doc! { "$sample": { "size": i64::from(size) } }])
        .await?;
    let mut documents = Vec::with_capacity(size as usize);
    while cursor.advance().await? {
        documents.push(cursor.deserialize_current()?);
    }
    Ok(summarize(&documents))
}

#[derive(Default)]
struct PathStats {
    documents: usize,
    types: HashMap<&'static str, usize>,
}

fn summarize(documents: &[Document]) -> Vec<FieldSummary> {
    let mut paths: HashMap<String, PathStats> = HashMap::new();
    for document in documents {
        let mut seen = HashMap::new();
        collect(document, "", 0, &mut seen);
        for (path, types) in seen {
            let stats = paths.entry(path).or_default();
            stats.documents += 1;
            for kind in types {
                *stats.types.entry(kind).or_default() += 1;
            }
        }
    }

    #[allow(clippy::cast_precision_loss)]
    let total = documents.len().max(1) as f64;
    let mut fields: Vec<FieldSummary> = paths
        .into_iter()
        .map(|(path, stats)| {
            let mut types: Vec<_> = stats.types.into_iter().collect();
            types.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(b.0)));
            #[allow(clippy::cast_precision_loss)]
            let frequency = stats.documents as f64 / total;
            FieldSummary {
                path,
                types: types.into_iter().map(|(kind, _)| kind.to_owned()).collect(),
                frequency,
            }
        })
        .collect();
    fields.sort_by(|a, b| {
        b.frequency
            .total_cmp(&a.frequency)
            .then_with(|| a.path.cmp(&b.path))
    });
    fields.truncate(MAX_FIELDS);
    fields
}

/// Records each path of `document` once per sampled document, with the types it holds.
fn collect(
    document: &Document,
    prefix: &str,
    depth: usize,
    seen: &mut HashMap<String, Vec<&'static str>>,
) {
    for (key, value) in document {
        let path = if prefix.is_empty() {
            key.clone()
        } else {
            format!("{prefix}.{key}")
        };
        record(value, &path, depth, seen);
    }
}

fn record(value: &Bson, path: &str, depth: usize, seen: &mut HashMap<String, Vec<&'static str>>) {
    let types = seen.entry(path.to_owned()).or_default();
    let kind = type_name(value);
    if !types.contains(&kind) {
        types.push(kind);
    }
    if depth + 1 >= MAX_DEPTH {
        return;
    }
    match value {
        Bson::Document(inner) => collect(inner, path, depth + 1, seen),
        Bson::Array(items) => {
            for item in items {
                if let Bson::Document(inner) = item {
                    collect(inner, path, depth + 1, seen);
                }
            }
        }
        _ => {}
    }
}

/// The names `$type` uses, so they read the same as in MongoDB's docs.
fn type_name(value: &Bson) -> &'static str {
    match value {
        Bson::Double(_) => "double",
        Bson::String(_) => "string",
        Bson::Document(_) => "object",
        Bson::Array(_) => "array",
        Bson::Binary(_) => "binData",
        Bson::Undefined => "undefined",
        Bson::ObjectId(_) => "objectId",
        Bson::Boolean(_) => "bool",
        Bson::DateTime(_) => "date",
        Bson::Null => "null",
        Bson::RegularExpression(_) => "regex",
        Bson::DbPointer(_) => "dbPointer",
        Bson::JavaScriptCode(_) => "javascript",
        Bson::Symbol(_) => "symbol",
        Bson::JavaScriptCodeWithScope(_) => "javascriptWithScope",
        Bson::Int32(_) => "int",
        Bson::Timestamp(_) => "timestamp",
        Bson::Int64(_) => "long",
        Bson::Decimal128(_) => "decimal",
        Bson::MinKey => "minKey",
        Bson::MaxKey => "maxKey",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn field<'a>(fields: &'a [FieldSummary], path: &str) -> &'a FieldSummary {
        fields
            .iter()
            .find(|field| field.path == path)
            .unwrap_or_else(|| panic!("missing {path}"))
    }

    #[test]
    fn nested_and_array_paths_use_dot_notation() {
        let fields = summarize(&[
            doc! { "name": "a", "address": { "city": "Rome" }, "items": [{ "sku": "x" }, { "sku": 1 }] },
            doc! { "name": 2_i32 },
        ]);

        assert_eq!(field(&fields, "name").frequency, 1.0);
        assert_eq!(field(&fields, "name").types.len(), 2);
        assert_eq!(field(&fields, "address.city").types, ["string"]);
        assert_eq!(field(&fields, "address.city").frequency, 0.5);
        assert_eq!(field(&fields, "items").types, ["array"]);
        let sku = field(&fields, "items.sku");
        assert_eq!(sku.frequency, 0.5, "counted once per document");
        assert_eq!(sku.types.len(), 2);
    }

    #[test]
    fn most_common_paths_come_first() {
        let fields = summarize(&[doc! { "b": 1, "a": 1 }, doc! { "b": 1 }]);
        let paths: Vec<_> = fields.iter().map(|field| field.path.as_str()).collect();
        assert_eq!(paths, ["b", "a"]);
    }

    #[test]
    fn depth_is_bounded() {
        let deep = doc! { "a": { "b": { "c": { "d": { "e": { "f": { "g": 1 } } } } } } };
        let fields = summarize(&[deep]);
        assert!(
            fields
                .iter()
                .all(|field| field.path.split('.').count() <= MAX_DEPTH)
        );
    }
}
