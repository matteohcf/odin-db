//! A whole database to a folder of JSON files and back, one file per collection.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use super::{
    ExportFormat, ExportRequest, ExportSource, ImportFormat, ImportOptions, JsonMode,
    TransferProgress, export_documents, import_documents,
};
use crate::CoreError;
use crate::browse::{self, CollectionKind};
use crate::connection::ConnectionHandle;
use crate::ejson::EJsonDocument;
use crate::query::{FindRequest, Namespace};

#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct DatabaseExportRequest {
    /// JSON array or NDJSON; CSV does not fit a whole database.
    pub format: ExportFormat,
    pub json_mode: JsonMode,
    /// Collections to export; empty means all of them (views excluded).
    pub collections: Vec<String>,
}

/// Progress across collections: which one is being moved, and how far it is.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct DatabaseProgress {
    pub collection: String,
    /// 1-based position of `collection` among `total`.
    pub index: f64,
    pub total: f64,
    pub documents: f64,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct DatabaseTransferSummary {
    pub collections: f64,
    pub documents: f64,
    /// Import only: documents replaced or merged, and records that failed.
    pub updated: f64,
    pub failed: f64,
    /// Import only: the first errors, prefixed with their file.
    pub errors: Vec<String>,
}

impl DatabaseTransferSummary {
    pub(super) fn new() -> Self {
        Self {
            collections: 0.0,
            documents: 0.0,
            updated: 0.0,
            failed: 0.0,
            errors: Vec::new(),
        }
    }
}

const MAX_ERRORS: usize = 20;

/// Exports each collection of `database` to `<folder>/<collection>.<ext>`.
/// Every file is written atomically, like single exports.
pub async fn export_database(
    handle: &ConnectionHandle,
    database: &str,
    folder: &Path,
    request: DatabaseExportRequest,
    progress: mpsc::Sender<DatabaseProgress>,
    cancel: CancellationToken,
) -> Result<DatabaseTransferSummary, CoreError> {
    let extension = match request.format {
        ExportFormat::JsonArray => "json",
        ExportFormat::Ndjson => "ndjson",
        ExportFormat::Csv => {
            return Err(CoreError::Validation(
                "export a database as JSON or NDJSON".into(),
            ));
        }
    };
    let collections: Vec<String> = browse::list_collections(handle, database)
        .await?
        .into_iter()
        .filter(|c| !matches!(c.kind, CollectionKind::View) && !c.name.starts_with("system."))
        .map(|c| c.name)
        .filter(|name| request.collections.is_empty() || request.collections.contains(name))
        .collect();
    std::fs::create_dir_all(folder)
        .map_err(|error| CoreError::Internal(format!("cannot create the folder: {error}")))?;

    let mut summary = DatabaseTransferSummary::new();
    let total = collections.len();
    for (index, collection) in collections.into_iter().enumerate() {
        let namespace = Namespace {
            database: database.to_owned(),
            collection: collection.clone(),
        };
        let forward = forward(&progress, &collection, index, total);
        let exported = export_documents(
            handle,
            &namespace,
            ExportRequest {
                source: ExportSource::Find {
                    request: FindRequest {
                        filter: EJsonDocument::from(bson::doc! {}),
                        projection: None,
                        sort: None,
                        skip: None,
                        limit: None,
                        batch_size: 1000,
                    },
                },
                format: request.format,
                json_mode: request.json_mode,
                csv_fields: Vec::new(),
            },
            &folder.join(format!("{}.{extension}", file_stem(&collection))),
            forward,
            // A child token per file: each transfer cancels its own when it ends.
            cancel.child_token(),
        )
        .await?;
        summary.collections += 1.0;
        summary.documents += exported.documents;
    }
    Ok(summary)
}

/// JSON files of a folder, as `(collection, path)` sorted by name: the
/// collection is the file name without its extension.
pub fn database_files(folder: &Path) -> Result<Vec<(String, PathBuf)>, CoreError> {
    let entries = std::fs::read_dir(folder)
        .map_err(|error| CoreError::Validation(format!("cannot read the folder: {error}")))?;
    let mut files: Vec<(String, PathBuf)> = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.is_file())
        .filter_map(|path| {
            let extension = path.extension()?.to_str()?.to_ascii_lowercase();
            if !matches!(extension.as_str(), "json" | "ndjson" | "jsonl") {
                return None;
            }
            let collection = path.file_stem()?.to_str()?.to_owned();
            Some((collection, path))
        })
        .collect();
    files.sort();
    Ok(files)
}

/// Imports each file into the collection named after it. `options.format`
/// is ignored: every file is read as JSON.
pub async fn import_database(
    handle: &ConnectionHandle,
    database: &str,
    files: Vec<(String, PathBuf)>,
    options: ImportOptions,
    progress: mpsc::Sender<DatabaseProgress>,
    cancel: CancellationToken,
) -> Result<DatabaseTransferSummary, CoreError> {
    handle.ensure_writable()?;
    let mut summary = DatabaseTransferSummary::new();
    let total = files.len();
    for (index, (collection, path)) in files.into_iter().enumerate() {
        let namespace = Namespace {
            database: database.to_owned(),
            collection: collection.clone(),
        };
        let forward = forward(&progress, &collection, index, total);
        let imported = import_documents(
            handle,
            &namespace,
            path,
            ImportOptions {
                format: ImportFormat::Json,
                ..options.clone()
            },
            forward,
            // A child token per file: each transfer cancels its own when it ends.
            cancel.child_token(),
        )
        .await?;
        summary.collections += 1.0;
        summary.documents += imported.inserted;
        summary.updated += imported.updated;
        summary.failed += imported.failed;
        for error in imported.errors {
            if summary.errors.len() < MAX_ERRORS {
                summary.errors.push(format!(
                    "{collection}, record {}: {}",
                    error.record, error.message
                ));
            }
        }
        if imported.stopped && options.stop_on_error {
            break;
        }
    }
    Ok(summary)
}

/// Relays one collection's progress as database progress, lossily like all progress.
pub(super) fn forward(
    progress: &mpsc::Sender<DatabaseProgress>,
    collection: &str,
    index: usize,
    total: usize,
) -> mpsc::Sender<TransferProgress> {
    let (tx, mut rx) = mpsc::channel::<TransferProgress>(16);
    let (progress, collection) = (progress.clone(), collection.to_owned());
    #[allow(clippy::cast_precision_loss)]
    let (index, total) = ((index + 1) as f64, total as f64);
    let _ = progress.try_send(DatabaseProgress {
        collection: collection.clone(),
        index,
        total,
        documents: 0.0,
    });
    tokio::spawn(async move {
        while let Some(step) = rx.recv().await {
            let _ = progress.try_send(DatabaseProgress {
                collection: collection.clone(),
                index,
                total,
                documents: step.documents,
            });
        }
    });
    tx
}

/// Collection names may contain characters file systems reject.
fn file_stem(collection: &str) -> String {
    collection
        .chars()
        .map(|c| {
            if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
                '_'
            } else {
                c
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_json_files_as_collections() {
        let folder = std::env::temp_dir().join(format!("odin-db-files-{}", uuid::Uuid::now_v7()));
        std::fs::create_dir_all(&folder).unwrap();
        for name in ["orders.json", "users.ndjson", "notes.txt", "Events.JSONL"] {
            std::fs::write(folder.join(name), "[]").unwrap();
        }
        let files = database_files(&folder).unwrap();
        let names: Vec<_> = files.iter().map(|(name, _)| name.as_str()).collect();
        assert_eq!(names, ["Events", "orders", "users"]);
        std::fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn file_names_are_safe() {
        assert_eq!(file_stem("logs/2026:10"), "logs_2026_10");
    }
}
