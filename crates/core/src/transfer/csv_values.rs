//! CSV cells to and from BSON. Types are always explicit (ADR-0019): `suggest_type`
//! only pre-fills the import form, the user confirms every column.

use std::str::FromStr;

use bson::{Bson, DateTime, Decimal128, Document, oid::ObjectId};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum CsvType {
    Skip,
    String,
    Int32,
    Int64,
    Double,
    Decimal,
    Boolean,
    Date,
    ObjectId,
    /// Extended JSON (canonical or relaxed), for nested documents and arrays.
    Json,
}

/// `None` means "leave the field out": empty cells are missing values, except
/// for strings, where an empty cell is an empty string.
pub fn parse_cell(text: &str, kind: CsvType) -> Result<Option<Bson>, String> {
    let trimmed = text.trim();
    if kind == CsvType::Skip || (trimmed.is_empty() && kind != CsvType::String) {
        return Ok(None);
    }
    let value = match kind {
        CsvType::Skip => return Ok(None),
        CsvType::String => Bson::String(text.to_owned()),
        CsvType::Int32 => Bson::Int32(
            trimmed
                .parse()
                .map_err(|_| format!("{trimmed:?} is not a 32-bit integer"))?,
        ),
        CsvType::Int64 => Bson::Int64(
            trimmed
                .parse()
                .map_err(|_| format!("{trimmed:?} is not a 64-bit integer"))?,
        ),
        CsvType::Double => Bson::Double(
            trimmed
                .parse()
                .map_err(|_| format!("{trimmed:?} is not a number"))?,
        ),
        CsvType::Decimal => Bson::Decimal128(
            Decimal128::from_str(trimmed).map_err(|_| format!("{trimmed:?} is not a decimal"))?,
        ),
        CsvType::Boolean => Bson::Boolean(match trimmed.to_ascii_lowercase().as_str() {
            "true" | "1" | "yes" => true,
            "false" | "0" | "no" => false,
            _ => return Err(format!("{trimmed:?} is not true or false")),
        }),
        CsvType::Date => {
            Bson::DateTime(DateTime::parse_rfc3339_str(trimmed).map_err(|_| {
                format!("{trimmed:?} is not an ISO 8601 date (2024-01-31T10:00:00Z)")
            })?)
        }
        CsvType::ObjectId => Bson::ObjectId(
            ObjectId::parse_str(trimmed).map_err(|_| format!("{trimmed:?} is not an ObjectId"))?,
        ),
        CsvType::Json => {
            let json: serde_json::Value =
                serde_json::from_str(trimmed).map_err(|error| format!("invalid JSON: {error}"))?;
            Bson::try_from(json).map_err(|error| format!("invalid Extended JSON: {error}"))?
        }
    };
    Ok(Some(value))
}

/// A cell for export: scalars as plain text, structures as relaxed Extended JSON.
pub fn format_cell(value: &Bson) -> String {
    match value {
        Bson::String(text) => text.clone(),
        Bson::Int32(n) => n.to_string(),
        Bson::Int64(n) => n.to_string(),
        Bson::Double(n) => n.to_string(),
        Bson::Decimal128(n) => n.to_string(),
        Bson::Boolean(b) => b.to_string(),
        Bson::DateTime(date) => date
            .try_to_rfc3339_string()
            .unwrap_or_else(|_| date.timestamp_millis().to_string()),
        Bson::ObjectId(id) => id.to_hex(),
        Bson::Null | Bson::Undefined => String::new(),
        other => other.clone().into_relaxed_extjson().to_string(),
    }
}

/// A starting type for an import column, from sample cells.
pub fn suggest_type<'a>(samples: impl IntoIterator<Item = &'a str>) -> CsvType {
    let values: Vec<&str> = samples
        .into_iter()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .collect();
    if values.is_empty() {
        return CsvType::String;
    }
    let all = |kind: CsvType| values.iter().all(|value| parse_cell(value, kind).is_ok());
    if values.iter().all(|value| value.len() == 24) && all(CsvType::ObjectId) {
        CsvType::ObjectId
    } else if all(CsvType::Int32) {
        CsvType::Int32
    } else if all(CsvType::Int64) {
        CsvType::Int64
    } else if all(CsvType::Double) {
        CsvType::Double
    } else if values
        .iter()
        .all(|value| matches!(value.to_ascii_lowercase().as_str(), "true" | "false"))
    {
        CsvType::Boolean
    } else if all(CsvType::Date) {
        CsvType::Date
    } else {
        CsvType::String
    }
}

/// Reads a dotted path such as `address.city`.
pub fn get_path<'a>(document: &'a Document, path: &str) -> Option<&'a Bson> {
    let mut parts = path.split('.');
    let mut current = document.get(parts.next()?)?;
    for part in parts {
        current = current.as_document()?.get(part)?;
    }
    Some(current)
}

/// Writes a dotted path, creating intermediate documents.
pub fn set_path(document: &mut Document, path: &str, value: Bson) -> Result<(), String> {
    match path.split_once('.') {
        None => {
            document.insert(path, value);
            Ok(())
        }
        Some((head, rest)) => {
            let child = document
                .entry(head.to_owned())
                .or_insert_with(|| Bson::Document(Document::new()));
            match child {
                Bson::Document(inner) => set_path(inner, rest, value),
                _ => Err(format!("{head:?} is both a value and a parent of {rest:?}")),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use bson::doc;

    use super::*;

    #[test]
    fn parses_each_type_and_treats_empty_cells_as_missing() {
        assert_eq!(parse_cell("42", CsvType::Int32), Ok(Some(Bson::Int32(42))));
        assert_eq!(
            parse_cell("9223372036854775807", CsvType::Int64),
            Ok(Some(Bson::Int64(i64::MAX)))
        );
        assert_eq!(
            parse_cell("1.5", CsvType::Double),
            Ok(Some(Bson::Double(1.5)))
        );
        assert_eq!(
            parse_cell("yes", CsvType::Boolean),
            Ok(Some(Bson::Boolean(true)))
        );
        assert_eq!(parse_cell("", CsvType::Int32), Ok(None));
        assert_eq!(
            parse_cell("", CsvType::String),
            Ok(Some(Bson::String(String::new())))
        );
        assert_eq!(parse_cell("x", CsvType::Skip), Ok(None));
        assert!(parse_cell("4.2", CsvType::Int32).is_err());
        assert!(matches!(
            parse_cell("2024-01-31T10:00:00Z", CsvType::Date),
            Ok(Some(Bson::DateTime(_)))
        ));
        assert_eq!(
            parse_cell(r#"{"a": {"$numberLong": "5"}}"#, CsvType::Json),
            Ok(Some(Bson::Document(doc! { "a": 5_i64 })))
        );
    }

    #[test]
    fn formats_scalars_plainly_and_structures_as_json() {
        let id = ObjectId::parse_str("650000000000000000000001").expect("valid");
        assert_eq!(format_cell(&Bson::ObjectId(id)), "650000000000000000000001");
        assert_eq!(format_cell(&Bson::Null), "");
        assert_eq!(format_cell(&Bson::Document(doc! { "a": 1 })), r#"{"a":1}"#);
        assert_eq!(
            format_cell(&Bson::DateTime(DateTime::from_millis(0))),
            "1970-01-01T00:00:00Z"
        );
    }

    #[test]
    fn suggests_types_from_samples() {
        assert_eq!(suggest_type(["1", "2", ""]), CsvType::Int32);
        assert_eq!(suggest_type(["1", "99999999999"]), CsvType::Int64);
        assert_eq!(suggest_type(["1", "2.5"]), CsvType::Double);
        assert_eq!(suggest_type(["true", "FALSE"]), CsvType::Boolean);
        assert_eq!(
            suggest_type(["650000000000000000000001"]),
            CsvType::ObjectId
        );
        assert_eq!(suggest_type(["2024-01-31T10:00:00Z"]), CsvType::Date);
        assert_eq!(suggest_type(["hello", "1"]), CsvType::String);
    }

    #[test]
    fn reads_and_writes_dotted_paths() {
        let mut document = Document::new();
        set_path(&mut document, "address.city", Bson::String("Milano".into())).expect("set");
        set_path(&mut document, "address.zip", Bson::String("20100".into())).expect("set");
        assert_eq!(
            document,
            doc! { "address": { "city": "Milano", "zip": "20100" } }
        );
        assert_eq!(
            get_path(&document, "address.city"),
            Some(&Bson::String("Milano".into()))
        );
        assert!(set_path(&mut document, "address.city.name", Bson::Null).is_err());
    }
}
