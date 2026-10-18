use std::sync::Arc;

use odin_core::compare::{self, CompareProgress, CompareRequest, CompareSummary, ComparedPair};
use odin_core::connection::ConnectionId;
use odin_core::ejson::EJsonValue;
use odin_core::operations::{OperationId, OperationRegistry};
use odin_core::query::Namespace;
use serde::Serialize;
use tauri::State;
use tauri::ipc::Channel;
use tokio::sync::mpsc;

use crate::ipc::{IpcError, StreamEvent, spawn_streaming_operation};
use crate::state::AppState;

/// Documents read so far, then exactly one `finished` with the counts.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
pub enum CompareEvent {
    Progress(CompareProgress),
    Finished(CompareSummary),
}

/// Compares two collections, possibly on different connections, as a cancellable operation.
#[tauri::command]
#[specta::specta]
pub async fn compare_collections(
    state: State<'_, Arc<AppState>>,
    registry: State<'_, Arc<OperationRegistry>>,
    left_connection_id: ConnectionId,
    right_connection_id: ConnectionId,
    request: CompareRequest,
    channel: Channel<StreamEvent<CompareEvent>>,
) -> Result<OperationId, IpcError> {
    let left = state.connections.get(left_connection_id).await?;
    let right = state.connections.get(right_connection_id).await?;
    Ok(spawn_streaming_operation(
        &registry,
        channel,
        move |tx, cancel| async move {
            let (progress_tx, mut progress_rx) = mpsc::channel(16);
            let events = tx.clone();
            tauri::async_runtime::spawn(async move {
                while let Some(progress) = progress_rx.recv().await {
                    if events.send(CompareEvent::Progress(progress)).await.is_err() {
                        break;
                    }
                }
            });
            let summary = compare::compare(&left, &right, request, progress_tx, cancel).await?;
            let _ = tx.send(CompareEvent::Finished(summary)).await;
            Ok(())
        },
    ))
}

/// Both versions of one compared document.
#[tauri::command]
#[specta::specta]
pub async fn compared_pair(
    state: State<'_, Arc<AppState>>,
    left_connection_id: ConnectionId,
    right_connection_id: ConnectionId,
    left: Namespace,
    right: Namespace,
    id: EJsonValue,
) -> Result<ComparedPair, IpcError> {
    let left_handle = state.connections.get(left_connection_id).await?;
    let right_handle = state.connections.get(right_connection_id).await?;
    Ok(compare::pair(&left_handle, &right_handle, &left, &right, id).await?)
}
