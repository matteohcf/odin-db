//! Single-document writes. Every write checks the profile's read-only flag first.

use bson::{Bson, Document, doc};

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
