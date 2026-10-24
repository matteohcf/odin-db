use std::sync::Arc;

use odin_core::connection::ConnectionId;
use odin_core::diagram::{self, DatabaseDiagram, DiagramProgress};
use odin_core::operations::{OperationId, OperationRegistry};
use serde::Serialize;
use tauri::State;
use tauri::ipc::Channel;
use tokio::sync::mpsc;

use crate::ipc::{IpcError, StreamEvent, spawn_streaming_operation};
use crate::state::AppState;

/// Collections sampled and references checked so far, then exactly one `finished`.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
pub enum DiagramEvent {
    Progress(DiagramProgress),
    Finished(DatabaseDiagram),
}

/// Samples a database's collections and infers their references, as a cancellable operation.
#[tauri::command]
#[specta::specta]
pub async fn database_diagram(
    state: State<'_, Arc<AppState>>,
    registry: State<'_, Arc<OperationRegistry>>,
    connection_id: ConnectionId,
    database: String,
    channel: Channel<StreamEvent<DiagramEvent>>,
) -> Result<OperationId, IpcError> {
    let handle = state.connections.get(connection_id).await?;
    Ok(spawn_streaming_operation(
        &registry,
        channel,
        move |tx, cancel| async move {
            let (progress_tx, mut progress_rx) = mpsc::channel(16);
            let events = tx.clone();
            tauri::async_runtime::spawn(async move {
                while let Some(progress) = progress_rx.recv().await {
                    if events.send(DiagramEvent::Progress(progress)).await.is_err() {
                        break;
                    }
                }
            });
            let found = diagram::database_diagram(&handle, &database, progress_tx, cancel).await?;
            let _ = tx.send(DiagramEvent::Finished(found)).await;
            Ok(())
        },
    ))
}
