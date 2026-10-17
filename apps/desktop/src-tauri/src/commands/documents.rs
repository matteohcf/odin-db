use std::sync::Arc;

use odin_core::connection::ConnectionId;
use odin_core::documents;
use odin_core::ejson::{EJsonDocument, EJsonValue};
use odin_core::query::{self, AggregateRequest, CursorId, DocumentPage, FindRequest, Namespace};
use tauri::State;

use crate::ipc::IpcError;
use crate::state::AppState;

#[tauri::command]
#[specta::specta]
pub async fn find_documents(
    state: State<'_, Arc<AppState>>,
    connection_id: ConnectionId,
    namespace: Namespace,
    request: FindRequest,
) -> Result<DocumentPage, IpcError> {
    let handle = state.connections.get(connection_id).await?;
    Ok(state.cursors.find(&handle, &namespace, request).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn fetch_more_documents(
    state: State<'_, Arc<AppState>>,
    cursor_id: CursorId,
    batch_size: u32,
) -> Result<DocumentPage, IpcError> {
    Ok(state.cursors.fetch_more(cursor_id, batch_size).await?)
}

#[tauri::command]
#[specta::specta]
pub fn close_cursor(state: State<'_, Arc<AppState>>, cursor_id: CursorId) {
    state.cursors.close(cursor_id);
}

#[tauri::command]
#[specta::specta]
pub async fn count_documents(
    state: State<'_, Arc<AppState>>,
    connection_id: ConnectionId,
    namespace: Namespace,
    filter: EJsonDocument,
) -> Result<f64, IpcError> {
    let handle = state.connections.get(connection_id).await?;
    Ok(query::count_documents(&handle, &namespace, filter).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn insert_document(
    state: State<'_, Arc<AppState>>,
    connection_id: ConnectionId,
    namespace: Namespace,
    document: EJsonDocument,
) -> Result<EJsonValue, IpcError> {
    let handle = state.connections.get(connection_id).await?;
    Ok(documents::insert(&handle, &namespace, document).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn replace_document(
    state: State<'_, Arc<AppState>>,
    connection_id: ConnectionId,
    namespace: Namespace,
    id: EJsonValue,
    document: EJsonDocument,
) -> Result<(), IpcError> {
    let handle = state.connections.get(connection_id).await?;
    Ok(documents::replace(&handle, &namespace, id, document).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn delete_document(
    state: State<'_, Arc<AppState>>,
    connection_id: ConnectionId,
    namespace: Namespace,
    id: EJsonValue,
) -> Result<(), IpcError> {
    let handle = state.connections.get(connection_id).await?;
    Ok(documents::delete(&handle, &namespace, id).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn aggregate_documents(
    state: State<'_, Arc<AppState>>,
    connection_id: ConnectionId,
    namespace: Namespace,
    request: AggregateRequest,
) -> Result<DocumentPage, IpcError> {
    let handle = state.connections.get(connection_id).await?;
    Ok(state
        .cursors
        .aggregate(&handle, &namespace, request)
        .await?)
}

/// First results of a pipeline for the builder's stage previews. Never runs `$out`/`$merge`.
#[tauri::command]
#[specta::specta]
pub async fn preview_aggregation(
    state: State<'_, Arc<AppState>>,
    connection_id: ConnectionId,
    namespace: Namespace,
    pipeline: Vec<EJsonDocument>,
    limit: u32,
) -> Result<Vec<EJsonDocument>, IpcError> {
    let handle = state.connections.get(connection_id).await?;
    Ok(query::preview_aggregation(&handle, &namespace, pipeline, limit).await?)
}
