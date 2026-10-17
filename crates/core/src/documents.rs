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
