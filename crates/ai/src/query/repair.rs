//! Fixes values a small model wrote in the wrong type, using the sampled field types.

use bson::oid::ObjectId;
use bson::{Bson, DateTime, Document};

use super::FieldHint;

/// Converts strings compared with date or `ObjectId` fields into those types:
/// `{"createdAt": {"$gt": "2025-01-01"}}` becomes a date comparison.
pub(super) fn filter(document: &mut Document, fields: &[FieldHint]) {
    for (key, value) in document.iter_mut() {
        match key.as_str() {
            "$and" | "$or" | "$nor" => {
                if let Bson::Array(items) = value {
                    for item in items {
                        if let Bson::Document(nested) = item {
                            filter(nested, fields);
                        }
                    }
                }
            }
            _ if key.starts_with('$') => {}
            path => {
                if let Some(field) = fields.iter().find(|field| field.path == path) {
                    convert(value, field);
                }
            }
        }
    }
}

fn convert(value: &mut Bson, field: &FieldHint) {
    match value {
        Bson::String(text) => {
            if let Some(converted) = typed(text, field) {
                *value = converted;
            }
        }
        // Operator values: `{"$gt": "…"}`, `{"$in": ["…"]}`.
        Bson::Document(operators) => {
            for (key, operand) in operators.iter_mut() {
                if !key.starts_with('$') || key == "$regex" || key == "$options" {
                    continue;
                }
                match operand {
                    Bson::Array(items) => items.iter_mut().for_each(|item| convert(item, field)),
                    _ => convert(operand, field),
                }
            }
        }
        _ => {}
    }
}

fn typed(text: &str, field: &FieldHint) -> Option<Bson> {
    let has = |name: &str| field.types.iter().any(|kind| kind == name);
    if has("date") {
        let instant = if text.len() == 10 {
            format!("{text}T00:00:00Z")
        } else {
            text.to_owned()
        };
        if let Ok(date) = DateTime::parse_rfc3339_str(&instant) {
            return Some(Bson::DateTime(date));
        }
    }
    if has("objectId")
        && let Ok(id) = ObjectId::parse_str(text)
    {
        return Some(Bson::ObjectId(id));
    }
    None
}

#[cfg(test)]
mod tests {
    use bson::doc;

    use super::*;

    fn hint(path: &str, kind: &str) -> FieldHint {
        FieldHint {
            path: path.into(),
            types: vec![kind.into()],
        }
    }

    #[test]
    fn converts_dates_and_ids_where_the_field_has_that_type() {
        let fields = [
            hint("createdAt", "date"),
            hint("userId", "objectId"),
            hint("name", "string"),
        ];
        let mut document = doc! {
            "createdAt": { "$gte": "2025-01-01", "$lt": "2025-02-01T00:00:00Z" },
            "$or": [{ "userId": "65f1a2b3c4d5e6f708192a3b" }, { "userId": { "$in": ["65f1a2b3c4d5e6f708192a3c"] } }],
            "name": "2025-01-01",
        };
        filter(&mut document, &fields);
        let created = document.get_document("createdAt").unwrap();
        assert!(matches!(created.get("$gte"), Some(Bson::DateTime(_))));
        assert!(matches!(created.get("$lt"), Some(Bson::DateTime(_))));
        let or = document.get_array("$or").unwrap();
        assert!(matches!(
            or[0].as_document().unwrap().get("userId"),
            Some(Bson::ObjectId(_))
        ));
        let within = or[1].as_document().unwrap().get_document("userId").unwrap();
        assert!(matches!(
            within.get_array("$in").unwrap()[0],
            Bson::ObjectId(_)
        ));
        assert_eq!(document.get_str("name").unwrap(), "2025-01-01");
    }

    #[test]
    fn leaves_regexes_and_unparseable_values_alone() {
        let fields = [hint("createdAt", "date")];
        let mut document = doc! { "createdAt": { "$regex": "2025" }, "other": "x" };
        let before = document.clone();
        filter(&mut document, &fields);
        assert_eq!(document, before);
    }
}
