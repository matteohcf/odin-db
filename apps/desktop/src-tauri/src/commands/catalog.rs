//! Creating, renaming and dropping databases and collections.

use std::sync::Arc;

use odin_core::catalog;
use odin_core::connection::ConnectionId;
use odin_core::query::Namespace;
use tauri::State;

use crate::ipc::IpcError;
use crate::state::AppState;

#[tauri::command]
#[specta::specta]
pub async fn create_collection(
    state: State<'_, Arc<AppState>>,
    connection_id: ConnectionId,
    namespace: Namespace,
) -> Result<(), IpcError> {
    let handle = state.connections.get(connection_id).await?;
    Ok(catalog::create_collection(&handle, &namespace).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn rename_collection(
    state: State<'_, Arc<AppState>>,
    connection_id: ConnectionId,
    namespace: Namespace,
    new_name: String,
) -> Result<(), IpcError> {
    let handle = state.connections.get(connection_id).await?;
    Ok(catalog::rename_collection(&handle, &namespace, &new_name).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn drop_collection(
    state: State<'_, Arc<AppState>>,
    connection_id: ConnectionId,
    namespace: Namespace,
) -> Result<(), IpcError> {
    let handle = state.connections.get(connection_id).await?;
    Ok(catalog::drop_collection(&handle, &namespace).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn drop_database(
    state: State<'_, Arc<AppState>>,
    connection_id: ConnectionId,
    database: String,
) -> Result<(), IpcError> {
    let handle = state.connections.get(connection_id).await?;
    Ok(catalog::drop_database(&handle, &database).await?)
}
