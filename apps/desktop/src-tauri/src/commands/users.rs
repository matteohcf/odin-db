//! Database users and roles.

use std::sync::Arc;

use odin_core::connection::ConnectionId;
use odin_core::secrets::Secret;
use odin_core::users::{self, CustomRole, Privilege, RoleInfo, RoleRef, UserInfo};
use tauri::State;

use crate::ipc::IpcError;
use crate::state::AppState;

#[tauri::command]
#[specta::specta]
pub async fn list_users(
    state: State<'_, Arc<AppState>>,
    connection_id: ConnectionId,
) -> Result<Vec<UserInfo>, IpcError> {
    let handle = state.connections.get(connection_id).await?;
    Ok(users::list_users(&handle).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn list_roles(
    state: State<'_, Arc<AppState>>,
    connection_id: ConnectionId,
    database: String,
) -> Result<Vec<RoleInfo>, IpcError> {
    let handle = state.connections.get(connection_id).await?;
    Ok(users::list_roles(&handle, &database).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn create_user(
    state: State<'_, Arc<AppState>>,
    connection_id: ConnectionId,
    database: String,
    name: String,
    password: Secret,
    roles: Vec<RoleRef>,
) -> Result<(), IpcError> {
    let handle = state.connections.get(connection_id).await?;
    Ok(users::create_user(&handle, &database, &name, &password, &roles).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn set_user_roles(
    state: State<'_, Arc<AppState>>,
    connection_id: ConnectionId,
    database: String,
    name: String,
    roles: Vec<RoleRef>,
) -> Result<(), IpcError> {
    let handle = state.connections.get(connection_id).await?;
    Ok(users::set_roles(&handle, &database, &name, &roles).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn change_user_password(
    state: State<'_, Arc<AppState>>,
    connection_id: ConnectionId,
    database: String,
    name: String,
    password: Secret,
) -> Result<(), IpcError> {
    let handle = state.connections.get(connection_id).await?;
    Ok(users::change_password(&handle, &database, &name, &password).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn drop_user(
    state: State<'_, Arc<AppState>>,
    connection_id: ConnectionId,
    database: String,
    name: String,
) -> Result<(), IpcError> {
    let handle = state.connections.get(connection_id).await?;
    Ok(users::drop_user(&handle, &database, &name).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn list_custom_roles(
    state: State<'_, Arc<AppState>>,
    connection_id: ConnectionId,
) -> Result<Vec<CustomRole>, IpcError> {
    let handle = state.connections.get(connection_id).await?;
    Ok(users::list_custom_roles(&handle).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn create_role(
    state: State<'_, Arc<AppState>>,
    connection_id: ConnectionId,
    database: String,
    name: String,
    privileges: Vec<Privilege>,
    roles: Vec<RoleRef>,
) -> Result<(), IpcError> {
    let handle = state.connections.get(connection_id).await?;
    Ok(users::create_role(&handle, &database, &name, &privileges, &roles).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn update_role(
    state: State<'_, Arc<AppState>>,
    connection_id: ConnectionId,
    database: String,
    name: String,
    privileges: Vec<Privilege>,
    roles: Vec<RoleRef>,
) -> Result<(), IpcError> {
    let handle = state.connections.get(connection_id).await?;
    Ok(users::update_role(&handle, &database, &name, &privileges, &roles).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn drop_role(
    state: State<'_, Arc<AppState>>,
    connection_id: ConnectionId,
    database: String,
    name: String,
) -> Result<(), IpcError> {
    let handle = state.connections.get(connection_id).await?;
    Ok(users::drop_role(&handle, &database, &name).await?)
}
