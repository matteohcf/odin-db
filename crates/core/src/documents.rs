//! Document writes, one at a time or by filter. Every write checks the profile's
//! read-only flag first.

use bson::{Bson, Document, doc};
use serde::Serialize;

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
