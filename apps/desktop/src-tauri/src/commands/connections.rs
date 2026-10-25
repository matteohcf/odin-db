use std::sync::Arc;

use odin_core::CoreError;
use odin_core::browse::{self, CollectionCount, CollectionInfo, CollectionStats, DatabaseInfo};
use odin_core::connection::{ConnectionId, ConnectionInfo};
use odin_core::profiles::{self, ProfileId};
use odin_core::query::Namespace;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::ipc::IpcError;
use crate::state::{AppState, blocking};

#[tauri::command]
#[specta::specta]
pub async fn connect(
    state: State<'_, Arc<AppState>>,
    profile_id: ProfileId,
) -> Result<ConnectionInfo, IpcError> {
    let (profile, password, ssh_secret) = blocking(&state, move |s| {
        let profile = profiles::get(&s.storage, s.secrets.as_ref(), profile_id)?;
        Ok((
            profile,
            s.secrets.password(profile_id)?,
            s.secrets.ssh_secret(profile_id)?,
        ))
    })
    .await?;
    Ok(state
        .connections
        .connect(&profile, password, ssh_secret)
        .await?)
}

#[tauri::command]
#[specta::specta]
pub async fn disconnect(
    state: State<'_, Arc<AppState>>,
    connection_id: ConnectionId,
) -> Result<(), IpcError> {
    state.cursors.close_for_connection(connection_id);
    state.close_shells_for(connection_id);
    Ok(state.connections.disconnect(connection_id).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn list_connections(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<ConnectionInfo>, IpcError> {
    Ok(state.connections.list().await)
}

#[tauri::command]
#[specta::specta]
pub async fn list_databases(
    state: State<'_, Arc<AppState>>,
    connection_id: ConnectionId,
) -> Result<Vec<DatabaseInfo>, IpcError> {
    let handle = state.connections.get(connection_id).await?;
    Ok(browse::list_databases(&handle).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn list_collections(
    state: State<'_, Arc<AppState>>,
    connection_id: ConnectionId,
    database: String,
) -> Result<Vec<CollectionInfo>, IpcError> {
    let handle = state.connections.get(connection_id).await?;
    Ok(browse::list_collections(&handle, &database).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn list_catalog(
    state: State<'_, Arc<AppState>>,
    connection_id: ConnectionId,
) -> Result<Vec<browse::DatabaseCatalog>, IpcError> {
    let handle = state.connections.get(connection_id).await?;
    Ok(browse::catalog(&handle).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn collection_stats(
    state: State<'_, Arc<AppState>>,
    connection_id: ConnectionId,
    namespace: Namespace,
) -> Result<CollectionStats, IpcError> {
    let handle = state.connections.get(connection_id).await?;
    Ok(browse::collection_stats(&handle, &namespace).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn collection_counts(
    state: State<'_, Arc<AppState>>,
    connection_id: ConnectionId,
    database: String,
) -> Result<Vec<CollectionCount>, IpcError> {
    let handle = state.connections.get(connection_id).await?;
    Ok(browse::collection_counts(&handle, &database).await?)
}

/// Asks for a certificate file (a CA, or a client certificate and key) and returns its
/// path, which goes into the connection string where the driver reads it. `None` if the
/// user cancels.
#[tauri::command]
#[specta::specta]
pub async fn choose_certificate_file(app: AppHandle) -> Result<Option<String>, IpcError> {
    let dialog = app
        .dialog()
        .file()
        .add_filter("Certificates", &["pem", "crt", "cer", "key"]);
    let Some(path) = super::transfer::blocking_dialog(move || dialog.blocking_pick_file()).await?
    else {
        return Ok(None);
    };
    let path = path
        .into_path()
        .map_err(|error| CoreError::Validation(error.to_string()))?;
    Ok(Some(path.to_string_lossy().into_owned()))
}
