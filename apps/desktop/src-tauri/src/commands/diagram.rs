use std::sync::Arc;

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use odin_core::CoreError;
use odin_core::connection::ConnectionId;
use odin_core::diagram::{self, DatabaseDiagram, DiagramProgress};
use odin_core::operations::{OperationId, OperationRegistry};
use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use super::transfer::blocking_dialog;
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

/// Asks where to save a PNG rendered by the diagram, then writes it. `None` if the user cancels.
#[tauri::command]
#[specta::specta]
pub async fn save_diagram_image(
    app: AppHandle,
    png_base64: String,
    database: String,
) -> Result<Option<String>, IpcError> {
    let bytes = STANDARD
        .decode(png_base64.trim_start_matches("data:image/png;base64,"))
        .map_err(|error| CoreError::Validation(format!("not a PNG image: {error}")))?;
    if !bytes.starts_with(b"\x89PNG") {
        return Err(CoreError::Validation("not a PNG image".into()).into());
    }
    // Only the suggested name comes from the webview, never the path.
    let name: String = database
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let dialog = app
        .dialog()
        .file()
        .set_file_name(format!("{name}-diagram.png"))
        .add_filter("PNG", &["png"]);
    let Some(path) = blocking_dialog(move || dialog.blocking_save_file()).await? else {
        return Ok(None);
    };
    let path = path
        .into_path()
        .map_err(|error| CoreError::Validation(error.to_string()))?;
    std::fs::write(&path, bytes)
        .map_err(|error| CoreError::Internal(format!("cannot write the file: {error}")))?;
    Ok(Some(path.display().to_string()))
}
