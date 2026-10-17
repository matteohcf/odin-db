use std::sync::Arc;

use odin_core::connection::ConnectionId;
use odin_core::indexes::{self, CreateIndexRequest, IndexInfo};
use odin_core::query::Namespace;
use tauri::State;

use crate::ipc::IpcError;
use crate::state::AppState;

#[tauri::command]
#[specta::specta]
pub async fn list_indexes(
    state: State<'_, Arc<AppState>>,
    connection_id: ConnectionId,
    namespace: Namespace,
) -> Result<Vec<IndexInfo>, IpcError> {
    let handle = state.connections.get(connection_id).await?;
    Ok(indexes::list(&handle, &namespace).await?)
}

/// Returns the name of the new index.
#[tauri::command]
#[specta::specta]
pub async fn create_index(
    state: State<'_, Arc<AppState>>,
    connection_id: ConnectionId,
    namespace: Namespace,
    request: CreateIndexRequest,
) -> Result<String, IpcError> {
    let handle = state.connections.get(connection_id).await?;
    Ok(indexes::create(&handle, &namespace, request).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn drop_index(
    state: State<'_, Arc<AppState>>,
    connection_id: ConnectionId,
    namespace: Namespace,
    name: String,
) -> Result<(), IpcError> {
    let handle = state.connections.get(connection_id).await?;
    Ok(indexes::drop(&handle, &namespace, &name).await?)
}
