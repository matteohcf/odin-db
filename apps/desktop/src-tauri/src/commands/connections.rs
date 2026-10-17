use std::sync::Arc;

use odin_core::browse::{self, CollectionInfo, DatabaseInfo};
use odin_core::connection::{ConnectionId, ConnectionInfo};
use odin_core::profiles::{self, ProfileId};
use tauri::State;

use crate::ipc::IpcError;
use crate::state::{AppState, blocking};

#[tauri::command]
#[specta::specta]
pub async fn connect(
    state: State<'_, Arc<AppState>>,
    profile_id: ProfileId,
) -> Result<ConnectionInfo, IpcError> {
    let (profile, password) = blocking(&state, move |s| {
        let profile = profiles::get(&s.storage, s.secrets.as_ref(), profile_id)?;
        let password = s.secrets.password(profile_id)?;
        Ok((profile, password))
    })
    .await?;
    Ok(state.connections.connect(&profile, password).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn disconnect(
    state: State<'_, Arc<AppState>>,
    connection_id: ConnectionId,
) -> Result<(), IpcError> {
    state.cursors.close_for_connection(connection_id);
    Ok(state.connections.disconnect(connection_id).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn list_connections(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<ConnectionInfo>, IpcError> {
    Ok(state.connections.list().await)
}

#[tauri::command]
#[specta::specta]
pub async fn list_databases(
    state: State<'_, Arc<AppState>>,
    connection_id: ConnectionId,
) -> Result<Vec<DatabaseInfo>, IpcError> {
    let handle = state.connections.get(connection_id).await?;
    Ok(browse::list_databases(&handle).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn list_collections(
    state: State<'_, Arc<AppState>>,
    connection_id: ConnectionId,
    database: String,
) -> Result<Vec<CollectionInfo>, IpcError> {
    let handle = state.connections.get(connection_id).await?;
    Ok(browse::list_collections(&handle, &database).await?)
}
