//! Value search across collections, as a cancellable operation (ADR-0055).

use std::sync::Arc;

use odin_core::connection::ConnectionId;
use odin_core::operations::{OperationId, OperationRegistry};
use odin_core::search::{self, SearchRequest, SearchSummary, SearchUpdate};
use serde::Serialize;
use tauri::State;
use tauri::ipc::Channel;
use tokio::sync::mpsc;

use crate::ipc::{IpcError, StreamEvent, spawn_streaming_operation};
use crate::state::AppState;

/// Progress and hits as they come, then exactly one `finished` with the totals.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
pub enum SearchEvent {
    Update(SearchUpdate),
    Finished(SearchSummary),
}

#[tauri::command]
#[specta::specta]
pub async fn search_values(
    state: State<'_, Arc<AppState>>,
    registry: State<'_, Arc<OperationRegistry>>,
    connection_id: ConnectionId,
    request: SearchRequest,
    channel: Channel<StreamEvent<SearchEvent>>,
) -> Result<OperationId, IpcError> {
    let handle = state.connections.get(connection_id).await?;
    Ok(spawn_streaming_operation(
        &registry,
        channel,
        move |tx, cancel| async move {
            let (updates_tx, mut updates_rx) = mpsc::channel(32);
            let events = tx.clone();
            let relay = tauri::async_runtime::spawn(async move {
                while let Some(update) = updates_rx.recv().await {
                    if events.send(SearchEvent::Update(update)).await.is_err() {
                        break;
                    }
                }
            });
            let summary = search::search(&handle, request, updates_tx, cancel).await;
            // Every hit reaches the UI before the summary that counts it.
            let _ = relay.await;
            let _ = tx.send(SearchEvent::Finished(summary?)).await;
            Ok(())
        },
    ))
}
