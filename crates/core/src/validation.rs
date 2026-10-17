//! A collection's document validation rules (validator, level and action).

use bson::{Bson, Document, doc};
use serde::{Deserialize, Serialize};

use crate::CoreError;
use crate::connection::ConnectionHandle;
use crate::ejson::EJsonDocument;
use crate::query::Namespace;

/// Which writes the rules apply to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum ValidationLevel {
    Off,
    Strict,
    /// Only inserts and updates of documents that already pass.
    Moderate,
}

/// What happens to a write that breaks the rules.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum ValidationAction {
    Error,
    /// Accepted, and logged by the server.
    Warn,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ValidationRules {
    /// Empty means no rules.
    pub validator: EJsonDocument,
    pub level: ValidationLevel,
    pub action: ValidationAction,
}

pub async fn get_rules(
    handle: &ConnectionHandle,
    namespace: &Namespace,
) -> Result<ValidationRules, CoreError> {
    let reply = handle
        .client
        .database(&namespace.database)
        .run_command(doc! { "listCollections": 1, "filter": { "name": &namespace.collection } })
        .await?;
    let spec = reply
        .get_document("cursor")
        .and_then(|cursor| cursor.get_array("firstBatch"))
        .ok()
        .and_then(|batch| batch.first())
        .and_then(Bson::as_document)
        .ok_or(CoreError::NotFound("collection"))?;
    let options = spec.get_document("options").cloned().unwrap_or_default();
    Ok(ValidationRules {
        validator: EJsonDocument::from(
            options
                .get_document("validator")
                .cloned()
                .unwrap_or_default(),
        ),
        level: match options.get_str("validationLevel") {
            Ok("off") => ValidationLevel::Off,
            Ok("moderate") => ValidationLevel::Moderate,
            _ => ValidationLevel::Strict,
        },
        action: match options.get_str("validationAction") {
            Ok("warn") => ValidationAction::Warn,
            _ => ValidationAction::Error,
        },
    })
}

pub async fn set_rules(
    handle: &ConnectionHandle,
    namespace: &Namespace,
    rules: ValidationRules,
) -> Result<(), CoreError> {
    handle.ensure_writable()?;
    let validator = Document::try_from(rules.validator)?;
    let level = match rules.level {
        ValidationLevel::Off => "off",
        ValidationLevel::Strict => "strict",
        ValidationLevel::Moderate => "moderate",
    };
    let action = match rules.action {
        ValidationAction::Error => "error",
        ValidationAction::Warn => "warn",
    };
    handle
        .client
        .database(&namespace.database)
        .run_command(doc! {
            "collMod": &namespace.collection,
            "validator": validator,
            "validationLevel": level,
            "validationAction": action,
        })
        .await?;
    Ok(())
}
