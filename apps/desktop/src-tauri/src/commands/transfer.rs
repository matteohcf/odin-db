//! Import and export (ADR-0019). File dialogs open from Rust, so the webview never
//! chooses a path itself (ADR-0017).

use std::path::PathBuf;
use std::sync::{Arc, PoisonError};

use odin_core::CoreError;
use odin_core::connection::ConnectionId;
use odin_core::operations::{OperationId, OperationRegistry};
use odin_core::query::Namespace;
use odin_core::transfer::{
    self, DatabaseExportRequest, DatabaseProgress, DatabaseTransferSummary, ExportFormat,
    ExportRequest, FilePreview, ImportOptions, ImportSummary, TransferProgress, TransferSummary,
};
use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use tokio::sync::mpsc;

use crate::ipc::{IpcError, StreamEvent, spawn_streaming_operation};
use crate::state::{AppState, blocking};

/// Progress of a transfer, then exactly one `finished` with its result.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
pub enum TransferEvent<S> {
    Progress(TransferProgress),
    Finished(S),
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ImportFile {
    /// Opaque handle for `import_documents`; the path stays in the backend.
    pub token: String,
    pub name: String,
    pub preview: FilePreview,
}

/// Asks where to save, then exports in the background. `None` if the user cancels.
#[tauri::command]
#[specta::specta]
pub async fn export_documents(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    registry: State<'_, Arc<OperationRegistry>>,
    connection_id: ConnectionId,
    namespace: Namespace,
    request: ExportRequest,
    channel: Channel<StreamEvent<TransferEvent<TransferSummary>>>,
) -> Result<Option<OperationId>, IpcError> {
    let handle = state.connections.get(connection_id).await?;
    let (extension, filter) = match request.format {
        ExportFormat::JsonArray => ("json", "JSON"),
        ExportFormat::Ndjson => ("ndjson", "NDJSON"),
        ExportFormat::Csv => ("csv", "CSV"),
    };
    let file_name = format!("{}.{extension}", namespace.collection);
    let dialog = app
        .dialog()
        .file()
        .set_file_name(&file_name)
        .add_filter(filter, &[extension]);
    let Some(path) = blocking_dialog(move || dialog.blocking_save_file()).await? else {
        return Ok(None);
    };
    let path = path
        .into_path()
        .map_err(|error| CoreError::Validation(error.to_string()))?;

    Ok(Some(spawn_streaming_operation(
        &registry,
        channel,
        move |tx, cancel| async move {
            let progress = forward_progress(tx.clone());
            let summary =
                transfer::export_documents(&handle, &namespace, request, &path, progress, cancel)
                    .await?;
            let _ = tx.send(TransferEvent::Finished(summary)).await;
            Ok(())
        },
    )))
}

/// Asks for a JSON, NDJSON or CSV file and previews it. `None` if the user cancels.
#[tauri::command]
#[specta::specta]
pub async fn choose_import_file(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<Option<ImportFile>, IpcError> {
    let dialog = app
        .dialog()
        .file()
        .add_filter("JSON, NDJSON or CSV", &["json", "ndjson", "jsonl", "csv"]);
    let Some(path) = blocking_dialog(move || dialog.blocking_pick_file()).await? else {
        return Ok(None);
    };
    let path: PathBuf = path
        .into_path()
        .map_err(|error| CoreError::Validation(error.to_string()))?;
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();

    let preview_path = path.clone();
    let preview = blocking(&state, move |_| transfer::preview_file(&preview_path)).await?;
    let token = uuid::Uuid::now_v7();
    state
        .picked_files
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .insert(token, path);
    Ok(Some(ImportFile {
        token: token.to_string(),
        name,
        preview,
    }))
}

#[tauri::command]
#[specta::specta]
pub async fn import_documents(
    state: State<'_, Arc<AppState>>,
    registry: State<'_, Arc<OperationRegistry>>,
    connection_id: ConnectionId,
    namespace: Namespace,
    token: String,
    options: ImportOptions,
    channel: Channel<StreamEvent<TransferEvent<ImportSummary>>>,
) -> Result<OperationId, IpcError> {
    let handle = state.connections.get(connection_id).await?;
    handle.ensure_writable()?;
    let token = uuid::Uuid::parse_str(&token).map_err(|_| CoreError::NotFound("import file"))?;
    let path = state
        .picked_files
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .remove(&token)
        .ok_or(CoreError::NotFound("import file"))?;

    Ok(spawn_streaming_operation(
        &registry,
        channel,
        move |tx, cancel| async move {
            let progress = forward_progress(tx.clone());
            let summary =
                transfer::import_documents(&handle, &namespace, path, options, progress, cancel)
                    .await?;
            let _ = tx.send(TransferEvent::Finished(summary)).await;
            Ok(())
        },
    ))
}

/// Core reports bare progress; the channel carries it wrapped in `TransferEvent`.
/// Progress across a database's collections, then exactly one `finished`.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
pub enum DatabaseTransferEvent {
    Progress(DatabaseProgress),
    Finished(DatabaseTransferSummary),
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ImportFolder {
    /// Opaque handle for `import_database`; the path stays in the backend.
    pub token: String,
    pub path: String,
    /// The collections the folder's JSON files would become.
    pub collections: Vec<String>,
}

/// Asks for a folder, then exports every collection of `database` into it.
/// `None` if the user cancels.
#[tauri::command]
#[specta::specta]
pub async fn export_database(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    registry: State<'_, Arc<OperationRegistry>>,
    connection_id: ConnectionId,
    database: String,
    request: DatabaseExportRequest,
    channel: Channel<StreamEvent<DatabaseTransferEvent>>,
) -> Result<Option<OperationId>, IpcError> {
    let handle = state.connections.get(connection_id).await?;
    let dialog = app.dialog().file();
    let Some(folder) = blocking_dialog(move || dialog.blocking_pick_folder()).await? else {
        return Ok(None);
    };
    let folder = folder
        .into_path()
        .map_err(|error| CoreError::Validation(error.to_string()))?
        .join(&database);
    Ok(Some(spawn_streaming_operation(
        &registry,
        channel,
        move |tx, cancel| async move {
            let progress = forward_database_progress(tx.clone());
            let summary =
                transfer::export_database(&handle, &database, &folder, request, progress, cancel)
                    .await?;
            let _ = tx.send(DatabaseTransferEvent::Finished(summary)).await;
            Ok(())
        },
    )))
}

/// Asks for a folder of JSON files to import as collections. `None` if the user cancels.
#[tauri::command]
#[specta::specta]
pub async fn choose_import_folder(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<Option<ImportFolder>, IpcError> {
    let dialog = app.dialog().file();
    let Some(folder) = blocking_dialog(move || dialog.blocking_pick_folder()).await? else {
        return Ok(None);
    };
    let folder = folder
        .into_path()
        .map_err(|error| CoreError::Validation(error.to_string()))?;
    let collections = transfer::database_files(&folder)?
        .into_iter()
        .map(|(collection, _)| collection)
        .collect();
    Ok(Some(ImportFolder {
        path: folder.display().to_string(),
        token: super::backup::remember_path(&state, folder),
        collections,
    }))
}

#[tauri::command]
#[specta::specta]
pub async fn import_database(
    state: State<'_, Arc<AppState>>,
    registry: State<'_, Arc<OperationRegistry>>,
    connection_id: ConnectionId,
    database: String,
    token: String,
    options: ImportOptions,
    channel: Channel<StreamEvent<DatabaseTransferEvent>>,
) -> Result<OperationId, IpcError> {
    let handle = state.connections.get(connection_id).await?;
    handle.ensure_writable()?;
    let token = uuid::Uuid::parse_str(&token).map_err(|_| CoreError::NotFound("import folder"))?;
    let folder = state
        .picked_files
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .get(&token)
        .cloned()
        .ok_or(CoreError::NotFound("import folder"))?;
    let files = transfer::database_files(&folder)?;
    Ok(spawn_streaming_operation(
        &registry,
        channel,
        move |tx, cancel| async move {
            let progress = forward_database_progress(tx.clone());
            let summary =
                transfer::import_database(&handle, &database, files, options, progress, cancel)
                    .await?;
            let _ = tx.send(DatabaseTransferEvent::Finished(summary)).await;
            Ok(())
        },
    ))
}

fn forward_database_progress(
    tx: mpsc::Sender<DatabaseTransferEvent>,
) -> mpsc::Sender<DatabaseProgress> {
    let (progress_tx, mut progress_rx) = mpsc::channel(16);
    tauri::async_runtime::spawn(async move {
        while let Some(progress) = progress_rx.recv().await {
            let _ = tx.try_send(DatabaseTransferEvent::Progress(progress));
        }
    });
    progress_tx
}

fn forward_progress<S: Send + 'static>(
    tx: mpsc::Sender<TransferEvent<S>>,
) -> mpsc::Sender<TransferProgress> {
    let (progress_tx, mut progress_rx) = mpsc::channel(16);
    tauri::async_runtime::spawn(async move {
        while let Some(progress) = progress_rx.recv().await {
            if tx.send(TransferEvent::Progress(progress)).await.is_err() {
                break;
            }
        }
    });
    progress_tx
}

/// Native dialogs block until dismissed: keep them off the async workers.
async fn blocking_dialog<T: Send + 'static>(
    open: impl FnOnce() -> T + Send + 'static,
) -> Result<T, CoreError> {
    tauri::async_runtime::spawn_blocking(open)
        .await
        .map_err(|error| CoreError::Internal(error.to_string()))
}
