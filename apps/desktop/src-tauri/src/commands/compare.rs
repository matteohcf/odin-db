use std::sync::Arc;

use odin_core::compare::{
    self, CompareProgress, CompareRequest, CompareSummary, ComparedPair, SyncRequest, SyncSummary,
};
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

/// Documents read so far, then exactly one `finished` with what changed.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
pub enum SyncEvent {
    Progress(CompareProgress),
    Finished(SyncSummary),
}

/// Forwards core progress into the operation's event stream.
fn forward<E: Send + 'static>(
    events: mpsc::Sender<E>,
    wrap: fn(CompareProgress) -> E,
) -> mpsc::Sender<CompareProgress> {
    let (progress_tx, mut progress_rx) = mpsc::channel(16);
    tauri::async_runtime::spawn(async move {
        while let Some(progress) = progress_rx.recv().await {
            if events.send(wrap(progress)).await.is_err() {
                break;
            }
        }
    });
    progress_tx
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
            let progress = forward(tx.clone(), CompareEvent::Progress);
            let summary = compare::compare(&left, &right, request, progress, cancel).await?;
            let _ = tx.send(CompareEvent::Finished(summary)).await;
            Ok(())
        },
    ))
}

/// Changes the right collection to match the left; read-only targets are refused.
#[tauri::command]
#[specta::specta]
pub async fn sync_collections(
    state: State<'_, Arc<AppState>>,
    registry: State<'_, Arc<OperationRegistry>>,
    left_connection_id: ConnectionId,
    right_connection_id: ConnectionId,
    request: SyncRequest,
    channel: Channel<StreamEvent<SyncEvent>>,
) -> Result<OperationId, IpcError> {
    let left = state.connections.get(left_connection_id).await?;
    let right = state.connections.get(right_connection_id).await?;
    right.ensure_writable()?;
    Ok(spawn_streaming_operation(
        &registry,
        channel,
        move |tx, cancel| async move {
            let progress = forward(tx.clone(), SyncEvent::Progress);
            let summary = compare::sync(&left, &right, request, progress, cancel).await?;
            let _ = tx.send(SyncEvent::Finished(summary)).await;
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
