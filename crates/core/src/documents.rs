//! Document writes, one at a time or by filter. Every write checks the profile's
//! read-only flag first.

use bson::{Bson, Document, doc};
use mongodb::options::UpdateModifications;
use serde::{Deserialize, Serialize};

use crate::CoreError;
use crate::connection::ConnectionHandle;
use crate::ejson::{EJsonDocument, EJsonValue};
use crate::query::Namespace;

/// Returns the `_id` of the inserted document.
pub async fn insert(
    handle: &ConnectionHandle,
    namespace: &Namespace,
    document: EJsonDocument,
) -> Result<EJsonValue, CoreError> {
    handle.ensure_writable()?;
    let result = namespace
        .collection(handle)?
        .insert_one(Document::try_from(document)?)
        .await?;
    Ok(EJsonValue::from(result.inserted_id))
}

/// Replaces the document whose `_id` is `id`.
pub async fn replace(
    handle: &ConnectionHandle,
    namespace: &Namespace,
    id: EJsonValue,
    document: EJsonDocument,
) -> Result<(), CoreError> {
    handle.ensure_writable()?;
    let id = Bson::try_from(id)?;
    let result = namespace
        .collection(handle)?
        .replace_one(doc! { "_id": id }, Document::try_from(document)?)
        .await?;
    if result.matched_count == 0 {
        return Err(CoreError::NotFound("document"));
    }
    Ok(())
}

/// Sets one top-level field of the document whose `_id` is `id`, leaving the
/// rest untouched (`$set`). `None` removes the field (`$unset`).
pub async fn set_field(
    handle: &ConnectionHandle,
    namespace: &Namespace,
    id: EJsonValue,
    field: &str,
    value: Option<EJsonValue>,
) -> Result<(), CoreError> {
    handle.ensure_writable()?;
    // `$set: { "a.b": … }` would write into a nested path, not this field.
    if field.is_empty() || field == "_id" || field.contains('.') || field.starts_with('$') {
        return Err(CoreError::Validation(format!(
            "{field} cannot be edited on its own; edit the whole document instead"
        )));
    }
    let id = Bson::try_from(id)?;
    let update = if let Some(value) = value {
        doc! { "$set": { field: Bson::try_from(value)? } }
    } else {
        doc! { "$unset": { field: "" } }
    };
    let result = namespace
        .collection(handle)?
        .update_one(doc! { "_id": id }, update)
        .await?;
    if result.matched_count == 0 {
        return Err(CoreError::NotFound("document"));
    }
    Ok(())
}

pub async fn delete(
    handle: &ConnectionHandle,
    namespace: &Namespace,
    id: EJsonValue,
) -> Result<(), CoreError> {
    handle.ensure_writable()?;
    let id = Bson::try_from(id)?;
    let result = namespace
        .collection(handle)?
        .delete_one(doc! { "_id": id })
        .await?;
    if result.deleted_count == 0 {
        return Err(CoreError::NotFound("document"));
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct UpdateManyResult {
    pub matched: f64,
    pub modified: f64,
}

/// Applies update operators such as `$set` to every document matching `filter`.
pub async fn update_many(
    handle: &ConnectionHandle,
    namespace: &Namespace,
    filter: EJsonDocument,
    update: EJsonDocument,
) -> Result<UpdateManyResult, CoreError> {
    handle.ensure_writable()?;
    let update = Document::try_from(update)?;
    // A plain document would be a replacement, which `updateMany` rejects anyway.
    if update.is_empty() || !update.keys().all(|key| key.starts_with('$')) {
        return Err(CoreError::Validation(
            "an update needs operators such as { $set: { field: value } }".into(),
        ));
    }
    let result = namespace
        .collection(handle)?
        .update_many(Document::try_from(filter)?, update)
        .await?;
    #[allow(clippy::cast_precision_loss)]
    Ok(UpdateManyResult {
        matched: result.matched_count as f64,
        modified: result.modified_count as f64,
    })
}

/// What to do to one field across many documents (ADR-0054).
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum FieldChange {
    Rename {
        to: String,
    },
    Remove,
    /// Values that cannot be converted are left as they are.
    Convert {
        to: ConvertTarget,
    },
}

/// BSON types a field can be converted to; the names are `$convert`'s.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum ConvertTarget {
    String,
    Int,
    Long,
    Double,
    Decimal,
    Bool,
    Date,
    ObjectId,
}

impl ConvertTarget {
    fn name(self) -> &'static str {
        match self {
            Self::String => "string",
            Self::Int => "int",
            Self::Long => "long",
            Self::Double => "double",
            Self::Decimal => "decimal",
            Self::Bool => "bool",
            Self::Date => "date",
            Self::ObjectId => "objectId",
        }
    }
}

fn validate_field_path(path: &str, what: &str) -> Result<(), CoreError> {
    if path.is_empty() || path.starts_with('$') || path.split('.').any(str::is_empty) {
        return Err(CoreError::Validation(format!(
            "{what} must be a field path such as address.city"
        )));
    }
    Ok(())
}

/// The filter and update that apply `change` to `field` in documents matching `filter`.
/// Only documents that have the field (and, to convert, of another type) are matched, so
/// `matched` counts the documents concerned and, for a conversion, `matched - modified`
/// the values that could not be converted.
fn field_update(
    filter: Document,
    field: &str,
    change: &FieldChange,
) -> Result<(Document, UpdateModifications), CoreError> {
    validate_field_path(field, "the field")?;
    if field == "_id" || field.starts_with("_id.") {
        return Err(CoreError::Validation("_id cannot be changed".into()));
    }
    let mut condition = doc! { "$exists": true };
    let mut clauses = vec![Bson::Document(filter)];
    let update = match change {
        FieldChange::Rename { to } => {
            let to = to.trim();
            validate_field_path(to, "the new name")?;
            if to == field || to == "_id" {
                return Err(CoreError::Validation(format!(
                    "{field} is already called {to}"
                )));
            }
            UpdateModifications::Document(doc! { "$rename": { field: to } })
        }
        FieldChange::Remove => UpdateModifications::Document(doc! { "$unset": { field: "" } }),
        FieldChange::Convert { to } => {
            condition.insert("$not", doc! { "$type": to.name() });
            let input = format!("${field}");
            // Through an array of subdocuments `$a.b` is every element's value, and `$set`
            // would write that whole array into each element: leave such values alone.
            clauses.push(Bson::Document(
                doc! { "$expr": { "$not": [{ "$isArray": &input }] } },
            ));
            UpdateModifications::Pipeline(vec![doc! {
                "$set": { field: { "$convert": {
                    "input": &input, "to": to.name(), "onError": &input, "onNull": &input,
                } } }
            }])
        }
    };
    clauses.insert(1, Bson::Document(doc! { field: condition }));
    let scoped = doc! { "$and": clauses };
    Ok((scoped, update))
}

/// Renames, removes or converts a field in every document matching `filter`.
pub async fn change_field(
    handle: &ConnectionHandle,
    namespace: &Namespace,
    filter: EJsonDocument,
    field: &str,
    change: &FieldChange,
) -> Result<UpdateManyResult, CoreError> {
    handle.ensure_writable()?;
    let (filter, update) = field_update(Document::try_from(filter)?, field, change)?;
    let result = namespace
        .collection(handle)?
        .update_many(filter, update)
        .await?;
    #[allow(clippy::cast_precision_loss)]
    Ok(UpdateManyResult {
        matched: result.matched_count as f64,
        modified: result.modified_count as f64,
    })
}

/// Deletes every document matching `filter`; returns how many went.
pub async fn delete_many(
    handle: &ConnectionHandle,
    namespace: &Namespace,
    filter: EJsonDocument,
) -> Result<f64, CoreError> {
    handle.ensure_writable()?;
    let result = namespace
        .collection(handle)?
        .delete_many(Document::try_from(filter)?)
        .await?;
    #[allow(clippy::cast_precision_loss)]
    Ok(result.deleted_count as f64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn field_changes_match_only_documents_concerned() {
        let (filter, update) = field_update(
            doc! { "a": 1 },
            "price",
            &FieldChange::Convert {
                to: ConvertTarget::Double,
            },
        )
        .expect("valid");
        assert_eq!(
            filter,
            doc! { "$and": [
                { "a": 1 },
                { "price": { "$exists": true, "$not": { "$type": "double" } } },
                { "$expr": { "$not": [{ "$isArray": "$price" }] } },
            ] }
        );
        assert!(matches!(update, UpdateModifications::Pipeline(_)));
        let (_, rename) = field_update(
            doc! {},
            "name",
            &FieldChange::Rename {
                to: " fullName ".into(),
            },
        )
        .expect("valid");
        assert!(matches!(
            rename,
            UpdateModifications::Document(d) if d == doc! { "$rename": { "name": "fullName" } }
        ));
        for (field, change) in [
            ("_id", FieldChange::Remove),
            ("a..b", FieldChange::Remove),
            ("name", FieldChange::Rename { to: "name".into() }),
            ("name", FieldChange::Rename { to: "$x".into() }),
        ] {
            assert!(field_update(doc! {}, field, &change).is_err(), "{field}");
        }
    }
}
