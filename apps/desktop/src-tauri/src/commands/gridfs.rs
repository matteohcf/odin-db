use std::sync::Arc;

use odin_core::CoreError;
use odin_core::connection::ConnectionId;
use odin_core::ejson::EJsonValue;
use odin_core::gridfs;
use odin_core::query::Namespace;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use super::transfer::blocking_dialog;
use crate::ipc::IpcError;
use crate::state::AppState;

fn bucket_of(namespace: &Namespace) -> Result<&str, CoreError> {
    gridfs::bucket_of(&namespace.collection)
        .ok_or_else(|| CoreError::Validation("not a GridFS files collection".into()))
}

/// Asks where to save a `GridFS` file and downloads it there. `None` if the user cancels.
#[tauri::command]
#[specta::specta]
pub async fn download_gridfs_file(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    connection_id: ConnectionId,
    namespace: Namespace,
    id: EJsonValue,
    filename: String,
) -> Result<Option<String>, IpcError> {
    let bucket = bucket_of(&namespace)?.to_owned();
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
    gridfs::download(&handle, &namespace.database, &bucket, id, &path).await?;
    Ok(Some(path.display().to_string()))
}

/// Asks for a file and stores it in the bucket. `None` if the user cancels.
#[tauri::command]
#[specta::specta]
pub async fn upload_gridfs_file(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    connection_id: ConnectionId,
    namespace: Namespace,
) -> Result<Option<EJsonValue>, IpcError> {
    let bucket = bucket_of(&namespace)?.to_owned();
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
    Ok(Some(
        gridfs::upload(&handle, &namespace.database, &bucket, &path).await?,
    ))
}
