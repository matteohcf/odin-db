use std::sync::Arc;

use odin_core::CoreError;
use odin_core::connection::ConnectionId;
use odin_core::ejson::EJsonValue;
use odin_core::gridfs::{self, FileProgress};
use odin_core::operations::{OperationId, OperationRegistry};
use odin_core::query::Namespace;
use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use tokio::sync::mpsc;

use super::transfer::blocking_dialog;
use crate::ipc::{IpcError, StreamEvent, spawn_streaming_operation};
use crate::state::AppState;

/// Bytes moved so far, then exactly one `finished` with the result.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
pub enum FileEvent<S> {
    Progress(FileProgress),
    Finished(S),
}

fn bucket_of(namespace: &Namespace) -> Result<String, CoreError> {
    gridfs::bucket_of(&namespace.collection)
        .map(str::to_owned)
        .ok_or_else(|| CoreError::Validation("not a GridFS files collection".into()))
}

fn forward<S: Send + 'static>(tx: mpsc::Sender<FileEvent<S>>) -> mpsc::Sender<FileProgress> {
    let (progress_tx, mut progress_rx) = mpsc::channel(16);
    tauri::async_runtime::spawn(async move {
        while let Some(progress) = progress_rx.recv().await {
            if tx.send(FileEvent::Progress(progress)).await.is_err() {
                break;
            }
        }
    });
    progress_tx
}

/// Asks where to save a `GridFS` file, then downloads it as a cancellable operation
/// that finishes with the saved path. `None` if the user cancels the dialog.
#[tauri::command]
#[specta::specta]
#[allow(clippy::too_many_arguments)]
pub async fn download_gridfs_file(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    registry: State<'_, Arc<OperationRegistry>>,
    connection_id: ConnectionId,
    namespace: Namespace,
    id: EJsonValue,
    filename: String,
    channel: Channel<StreamEvent<FileEvent<String>>>,
) -> Result<Option<OperationId>, IpcError> {
    let bucket = bucket_of(&namespace)?;
    let handle = state.connections.get(connection_id).await?;
    let dialog = app
        .dialog()
        .file()
        .set_file_name(gridfs::safe_file_name(&filename));
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
            let progress = forward(tx.clone());
            gridfs::download(
                &handle,
                &namespace.database,
                &bucket,
                id,
                &path,
                progress,
                cancel,
            )
            .await?;
            let _ = tx
                .send(FileEvent::Finished(path.display().to_string()))
                .await;
            Ok(())
        },
    )))
}

/// Asks for a file, then stores it in the bucket as a cancellable operation that
/// finishes with the new file's id. `None` if the user cancels the dialog.
#[tauri::command]
#[specta::specta]
pub async fn upload_gridfs_file(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    registry: State<'_, Arc<OperationRegistry>>,
    connection_id: ConnectionId,
    namespace: Namespace,
    channel: Channel<StreamEvent<FileEvent<EJsonValue>>>,
) -> Result<Option<OperationId>, IpcError> {
    let bucket = bucket_of(&namespace)?;
    let handle = state.connections.get(connection_id).await?;
    // Read-only is checked before the dialog, so nobody picks a file for nothing.
    handle.ensure_writable()?;
    let dialog = app.dialog().file();
    let Some(path) = blocking_dialog(move || dialog.blocking_pick_file()).await? else {
        return Ok(None);
    };
    let path = path
        .into_path()
        .map_err(|error| CoreError::Validation(error.to_string()))?;
    Ok(Some(spawn_streaming_operation(
        &registry,
        channel,
        move |tx, cancel| async move {
            let progress = forward(tx.clone());
            let id = gridfs::upload(
                &handle,
                &namespace.database,
                &bucket,
                &path,
                progress,
                cancel,
            )
            .await?;
            let _ = tx.send(FileEvent::Finished(id)).await;
            Ok(())
        },
    )))
}
