//! Server monitor: status samples, running operations, killing one, the profiler.

use std::sync::Arc;

use odin_core::connection::ConnectionId;
use odin_core::ejson::EJsonValue;
use odin_core::monitor::{self, CurrentOp, ReplicaSetStatus, ServerStatus};
use odin_core::profiler::{self, ProfileEntry, ProfileQuery, ProfilingStatus};
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
pub async fn replica_set_status(
    state: State<'_, Arc<AppState>>,
    connection_id: ConnectionId,
) -> Result<Option<ReplicaSetStatus>, IpcError> {
    let handle = state.connections.get(connection_id).await?;
    Ok(monitor::replica_set_status(&handle).await?)
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

#[tauri::command]
#[specta::specta]
pub async fn profiling_status(
    state: State<'_, Arc<AppState>>,
    connection_id: ConnectionId,
    database: String,
) -> Result<ProfilingStatus, IpcError> {
    let handle = state.connections.get(connection_id).await?;
    Ok(profiler::status(&handle, &database).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn set_profiling_status(
    state: State<'_, Arc<AppState>>,
    connection_id: ConnectionId,
    database: String,
    status: ProfilingStatus,
) -> Result<(), IpcError> {
    let handle = state.connections.get(connection_id).await?;
    Ok(profiler::set_status(&handle, &database, status).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn profile_entries(
    state: State<'_, Arc<AppState>>,
    connection_id: ConnectionId,
    query: ProfileQuery,
) -> Result<Vec<ProfileEntry>, IpcError> {
    let handle = state.connections.get(connection_id).await?;
    Ok(profiler::entries(&handle, query).await?)
}
