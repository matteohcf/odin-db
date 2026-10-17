//! App-wide notifications pushed to the UI as typed events (ADR-0006).

use std::sync::Arc;

use odin_core::connection::ConnectionId;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_specta::Event;
use tokio::sync::broadcast::error::RecvError;

use crate::state::AppState;

/// A connection's servers stopped answering, or answer again.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionHealthChanged {
    pub connection_id: ConnectionId,
    pub reachable: bool,
}

/// The backup history or schedules changed (a backup started or finished).
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, Event)]
pub struct BackupsChanged {}

/// Forwards core's health changes to the webview for the app's lifetime.
pub fn forward_health_changes(app: AppHandle, state: &Arc<AppState>) {
    let mut changes = state.connections.health_changes();
    tauri::async_runtime::spawn(async move {
        loop {
            match changes.recv().await {
                Ok(change) => {
                    let _ = ConnectionHealthChanged {
                        connection_id: change.connection_id,
                        reachable: change.reachable,
                    }
                    .emit(&app);
                }
                // Missed changes are superseded by the next one for the same connection.
                Err(RecvError::Lagged(_)) => {}
                Err(RecvError::Closed) => break,
            }
        }
    });
}
