use std::sync::Arc;

use odin_core::connection::{self, ServerInfo};
use odin_core::profiles::{self, ConnectionProfile, ProfileId, ProfileInput, split_password};
use tauri::State;

use crate::ipc::IpcError;
use crate::state::{AppState, blocking};

#[tauri::command]
#[specta::specta]
pub async fn list_profiles(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<ConnectionProfile>, IpcError> {
    Ok(blocking(&state, |s| profiles::list(&s.storage, s.secrets.as_ref())).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn create_profile(
    state: State<'_, Arc<AppState>>,
    input: ProfileInput,
) -> Result<ConnectionProfile, IpcError> {
    Ok(blocking(&state, move |s| {
        profiles::create(&s.storage, s.secrets.as_ref(), input)
    })
    .await?)
}

#[tauri::command]
#[specta::specta]
pub async fn update_profile(
    state: State<'_, Arc<AppState>>,
    id: ProfileId,
    input: ProfileInput,
) -> Result<ConnectionProfile, IpcError> {
    Ok(blocking(&state, move |s| {
        profiles::update(&s.storage, s.secrets.as_ref(), id, input)
    })
    .await?)
}

/// Closes the profile's connection, if open, before deleting it and its password.
#[tauri::command]
#[specta::specta]
pub async fn delete_profile(
    state: State<'_, Arc<AppState>>,
    id: ProfileId,
) -> Result<(), IpcError> {
    if let Some(handle) = state.connections.find_by_profile(id).await {
        state.cursors.close_for_connection(handle.info.id);
        state.connections.disconnect(handle.info.id).await?;
    }
    Ok(blocking(&state, move |s| {
        profiles::delete(&s.storage, s.secrets.as_ref(), id)
    })
    .await?)
}

/// Tests unsaved settings. Without a new password, the saved one of `profile_id` is used.
#[tauri::command]
#[specta::specta]
pub async fn test_connection(
    state: State<'_, Arc<AppState>>,
    input: ProfileInput,
    profile_id: Option<ProfileId>,
) -> Result<ServerInfo, IpcError> {
    let (connection_string, embedded) = split_password(&input.connection_string)?;
    let password = match input.password.or(embedded) {
        Some(password) => Some(password),
        None => match profile_id {
            Some(id) => blocking(&state, move |s| s.secrets.password(id)).await?,
            None => None,
        },
    };
    Ok(connection::test_connection(&connection_string, password).await?)
}
