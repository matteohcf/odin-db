use bson::{Bson, Document};
use serde::{Deserialize, Serialize};

use crate::CoreError;

/// A BSON document encoded as canonical Extended JSON v2 (ADR-0007).
///
/// Canonical form keeps every BSON type explicit, so a document edited in the UI
/// round-trips without silently changing numeric types.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(transparent)]
pub struct EJsonDocument(
    #[cfg_attr(feature = "specta", specta(type = JsonValue))] serde_json::Value,
);

/// TypeScript shape of a JSON value. Exists only because specta refuses to export
/// `serde_json::Number` (it may hold an `i64`); canonical EJSON carries large
/// integers as strings, so `number` is safe here.
#[cfg(feature = "specta")]
#[derive(Serialize, specta::Type)]
#[serde(untagged)]
#[allow(dead_code)]
enum JsonValue {
    Null(()),
    Bool(bool),
    Number(f64),
    String(String),
    Array(Vec<JsonValue>),
    Object(std::collections::HashMap<String, JsonValue>),
}

impl From<Document> for EJsonDocument {
    fn from(document: Document) -> Self {
        Self(Bson::Document(document).into_canonical_extjson())
    }
}

impl TryFrom<EJsonDocument> for Document {
    type Error = CoreError;

    fn try_from(value: EJsonDocument) -> Result<Self, Self::Error> {
        match Bson::try_from(value.0) {
            Ok(Bson::Document(document)) => Ok(document),
            Ok(other) => Err(CoreError::Validation(format!(
                "expected a document, got {:?}",
                other.element_type()
            ))),
            Err(error) => Err(CoreError::Validation(error.to_string())),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::str::FromStr;

    use bson::{Binary, DateTime, Decimal128, doc, oid::ObjectId, spec::BinarySubtype};

    use super::*;

    #[test]
    fn round_trip_preserves_every_numeric_type_and_edge_value() {
        let original = doc! {
            "_id": ObjectId::from_bytes([1; 12]),
            "int32": 5_i32,
            "int64_small": 5_i64,
            "int64_max": i64::MAX,
            "double_whole": 5.0_f64,
            "negative_zero": -0.0_f64,
            "nan": f64::NAN,
            "decimal": Decimal128::from_str("1234567890.123456789").expect("valid decimal"),
            "date": DateTime::from_millis(1_700_000_000_000),
            "binary": Binary { subtype: BinarySubtype::Generic, bytes: vec![0, 1, 2, 255] },
            "nested": { "list": [1_i32, 2_i64, "three", null, { "deep": true }] },
        };

        let encoded = EJsonDocument::from(original.clone());
        let decoded = Document::try_from(encoded).expect("decodes");

        for (key, value) in &original {
            let round_tripped = decoded.get(key).expect("key present");
            assert_eq!(
                value.element_type(),
                round_tripped.element_type(),
                "type changed for {key}"
            );
        }
        assert_eq!(decoded.get_i64("int64_max").ok(), Some(i64::MAX));
        assert!(
            decoded
                .get_f64("negative_zero")
                .is_ok_and(f64::is_sign_negative)
        );
        assert!(decoded.get_f64("nan").is_ok_and(f64::is_nan));
        assert_eq!(decoded.get("decimal"), original.get("decimal"));
        assert_eq!(decoded.get("nested"), original.get("nested"));
    }

    #[test]
    fn rejects_non_document_values() {
        let value = EJsonDocument(serde_json::json!([1, 2, 3]));
        assert!(matches!(
            Document::try_from(value),
            Err(CoreError::Validation(_))
        ));
    }
}
