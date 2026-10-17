use std::sync::Arc;

use odin_core::CoreError;
use odin_core::connection::{self, ServerInfo};
use odin_core::profiles::{
    self, ConnectionProfile, ImportedProfiles, ProfileId, ProfileInput, split_password,
};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use super::transfer::blocking_dialog;

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

/// A copy of the profile under `name` (localized by the UI), password included.
#[tauri::command]
#[specta::specta]
pub async fn duplicate_profile(
    state: State<'_, Arc<AppState>>,
    id: ProfileId,
    name: String,
) -> Result<ConnectionProfile, IpcError> {
    Ok(blocking(&state, move |s| {
        profiles::duplicate(&s.storage, s.secrets.as_ref(), id, &name)
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
        state.close_shells_for(handle.info.id);
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
    let (saved_password, saved_ssh_secret, saved_pin) = match profile_id {
        Some(id) => {
            blocking(&state, move |s| {
                let pin = profiles::get(&s.storage, s.secrets.as_ref(), id)?.ssh_host_key;
                Ok((s.secrets.password(id)?, s.secrets.ssh_secret(id)?, pin))
            })
            .await?
        }
        None => (None, None, None),
    };
    let password = input.password.or(embedded).or(saved_password);
    let ssh_secret = input.ssh_secret.or(saved_ssh_secret);
    // A fingerprint confirmed in the dialog wins; otherwise the saved pin applies.
    let pinned = input.ssh_host_key.or(saved_pin);
    let ssh = input.ssh.as_ref().map(|settings| connection::SshRoute {
        settings,
        secret: ssh_secret.as_ref(),
        pinned: pinned.as_deref(),
    });
    Ok(connection::test_connection(&connection_string, password, ssh).await?)
}

/// Asks where to save, then writes the profiles (all when `ids` is empty)
/// without passwords. `None` if the user cancels.
#[tauri::command]
#[specta::specta]
pub async fn export_connections(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    ids: Vec<ProfileId>,
) -> Result<Option<String>, IpcError> {
    let json = blocking(&state, move |s| profiles::export_profiles(&s.storage, &ids)).await?;
    let dialog = app
        .dialog()
        .file()
        .set_file_name("odin-db-connections.json")
        .add_filter("JSON", &["json"]);
    let Some(path) = blocking_dialog(move || dialog.blocking_save_file()).await? else {
        return Ok(None);
    };
    let path = path
        .into_path()
        .map_err(|error| CoreError::Validation(error.to_string()))?;
    std::fs::write(&path, json)
        .map_err(|error| CoreError::Internal(format!("cannot write the file: {error}")))?;
    Ok(Some(path.display().to_string()))
}

/// Asks for a connections file (odin-db or Compass) and imports it.
/// `None` if the user cancels.
#[tauri::command]
#[specta::specta]
pub async fn import_connections(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<Option<ImportedProfiles>, IpcError> {
    let dialog = app.dialog().file().add_filter("JSON", &["json"]);
    let Some(path) = blocking_dialog(move || dialog.blocking_pick_file()).await? else {
        return Ok(None);
    };
    let path = path
        .into_path()
        .map_err(|error| CoreError::Validation(error.to_string()))?;
    let json = std::fs::read_to_string(&path)
        .map_err(|error| CoreError::Validation(format!("cannot read the file: {error}")))?;
    Ok(Some(
        blocking(&state, move |s| {
            profiles::import_profiles(&s.storage, s.secrets.as_ref(), &json)
        })
        .await?,
    ))
}

/// Trusts the SSH host key the user confirmed after an `unknownHostKey` error.
#[tauri::command]
#[specta::specta]
pub async fn trust_ssh_host_key(
    state: State<'_, Arc<AppState>>,
    id: ProfileId,
    fingerprint: String,
) -> Result<(), IpcError> {
    Ok(blocking(&state, move |s| {
        profiles::trust_host_key(&s.storage, id, &fingerprint)
    })
    .await?)
}

/// Asks for a private key file for an SSH tunnel. The path is shown to the
/// user and stored with the profile; the key itself is read only to connect.
#[tauri::command]
#[specta::specta]
pub async fn choose_ssh_key(app: AppHandle) -> Result<Option<String>, IpcError> {
    let dialog = app.dialog().file();
    let Some(path) = blocking_dialog(move || dialog.blocking_pick_file()).await? else {
        return Ok(None);
    };
    let path = path
        .into_path()
        .map_err(|error| CoreError::Validation(error.to_string()))?;
    Ok(Some(path.display().to_string()))
}
