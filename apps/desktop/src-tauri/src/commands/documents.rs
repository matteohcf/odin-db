use std::sync::Arc;

use odin_core::changes::{self, ChangeFeed};
use odin_core::connection::ConnectionId;
use odin_core::documents::{self, UpdateManyResult};
use odin_core::ejson::{EJsonDocument, EJsonValue};
use odin_core::explain::{self, ExplainRequest, QueryPlan};
use odin_core::operations::{OperationId, OperationRegistry};
use odin_core::query::{
    self, AggregateRequest, CursorId, DistinctValue, DocumentPage, FindRequest, Namespace,
};
use odin_core::schema::{self, FieldSummary};
use tauri::State;
use tauri::ipc::Channel;

use crate::ipc::{IpcError, StreamEvent, spawn_passive_streaming_operation};
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

/// How the server runs a find: winning plan, indexes and counts.
#[tauri::command]
#[specta::specta]
pub async fn explain_find(
    state: State<'_, Arc<AppState>>,
    connection_id: ConnectionId,
    namespace: Namespace,
    request: ExplainRequest,
) -> Result<QueryPlan, IpcError> {
    let handle = state.connections.get(connection_id).await?;
    Ok(explain::explain_find(&handle, &namespace, request).await?)
}

/// Field paths of a sample of the collection, for query autocompletion.
#[tauri::command]
#[specta::specta]
pub async fn sample_fields(
    state: State<'_, Arc<AppState>>,
    connection_id: ConnectionId,
    namespace: Namespace,
    size: u32,
) -> Result<Vec<FieldSummary>, IpcError> {
    let handle = state.connections.get(connection_id).await?;
    Ok(schema::sample_fields(&handle, &namespace, size).await?)
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

/// Sets (or, with `value: null`, removes) one top-level field of a document.
#[tauri::command]
#[specta::specta]
pub async fn set_document_field(
    state: State<'_, Arc<AppState>>,
    connection_id: ConnectionId,
    namespace: Namespace,
    id: EJsonValue,
    field: String,
    // Required: an optional value would read a JSON `null` as "remove the field".
    value: EJsonValue,
) -> Result<(), IpcError> {
    let handle = state.connections.get(connection_id).await?;
    Ok(documents::set_field(&handle, &namespace, id, &field, Some(value)).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn unset_document_field(
    state: State<'_, Arc<AppState>>,
    connection_id: ConnectionId,
    namespace: Namespace,
    id: EJsonValue,
    field: String,
) -> Result<(), IpcError> {
    let handle = state.connections.get(connection_id).await?;
    Ok(documents::set_field(&handle, &namespace, id, &field, None).await?)
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
pub async fn distinct_values(
    state: State<'_, Arc<AppState>>,
    connection_id: ConnectionId,
    namespace: Namespace,
    field: String,
    filter: EJsonDocument,
    limit: u32,
) -> Result<Vec<DistinctValue>, IpcError> {
    let handle = state.connections.get(connection_id).await?;
    Ok(query::distinct_values(&handle, &namespace, &field, filter, limit).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn update_documents(
    state: State<'_, Arc<AppState>>,
    connection_id: ConnectionId,
    namespace: Namespace,
    filter: EJsonDocument,
    update: EJsonDocument,
) -> Result<UpdateManyResult, IpcError> {
    let handle = state.connections.get(connection_id).await?;
    Ok(documents::update_many(&handle, &namespace, filter, update).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn delete_documents(
    state: State<'_, Arc<AppState>>,
    connection_id: ConnectionId,
    namespace: Namespace,
    filter: EJsonDocument,
) -> Result<f64, IpcError> {
    let handle = state.connections.get(connection_id).await?;
    Ok(documents::delete_many(&handle, &namespace, filter).await?)
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

/// Streams a collection's changes until stopped; quitting does not ask about it.
#[tauri::command]
#[specta::specta]
pub async fn watch_changes(
    state: State<'_, Arc<AppState>>,
    registry: State<'_, Arc<OperationRegistry>>,
    connection_id: ConnectionId,
    namespace: Namespace,
    channel: Channel<StreamEvent<ChangeFeed>>,
) -> Result<OperationId, IpcError> {
    let handle = state.connections.get(connection_id).await?;
    Ok(spawn_passive_streaming_operation(
        &registry,
        channel,
        move |tx, cancel| async move { changes::watch(&handle, &namespace, tx, cancel).await },
    ))
}
