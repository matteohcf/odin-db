//! Server monitor: status samples, running operations, killing one.

use std::sync::Arc;

use odin_core::connection::ConnectionId;
use odin_core::ejson::EJsonValue;
use odin_core::monitor::{self, CurrentOp, ServerStatus};
use tauri::State;

use crate::ipc::IpcError;
use crate::state::AppState;

#[tauri::command]
#[specta::specta]
pub async fn server_status(
    state: State<'_, Arc<AppState>>,
    connection_id: ConnectionId,
) -> Result<ServerStatus, IpcError> {
    let handle = state.connections.get(connection_id).await?;
    Ok(monitor::server_status(&handle).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn current_ops(
    state: State<'_, Arc<AppState>>,
    connection_id: ConnectionId,
) -> Result<Vec<CurrentOp>, IpcError> {
    let handle = state.connections.get(connection_id).await?;
    Ok(monitor::current_ops(&handle).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn kill_op(
    state: State<'_, Arc<AppState>>,
    connection_id: ConnectionId,
    opid: EJsonValue,
) -> Result<(), IpcError> {
    let handle = state.connections.get(connection_id).await?;
    Ok(monitor::kill_op(&handle, opid).await?)
}
