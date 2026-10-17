//! Integrated mongosh sessions (ADR-0013, ADR-0030).

use std::sync::{Arc, PoisonError};

use odin_core::CoreError;
use odin_core::connection::ConnectionId;
use odin_core::shell::{self, ShellEvent, ShellOptions, ShellSession};
use serde::Serialize;
use tauri::State;
use tauri::ipc::Channel;
use tokio::sync::mpsc;

use crate::ipc::IpcError;
use crate::state::{AppState, profile_credentials};

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct MongoshStatus {
    pub available: bool,
    pub version: Option<String>,
}

#[tauri::command]
#[specta::specta]
pub async fn mongosh_status() -> Result<MongoshStatus, IpcError> {
    let Some(path) = shell::locate_mongosh(None) else {
        return Ok(MongoshStatus {
            available: false,
            version: None,
        });
    };
    let version = tokio::process::Command::new(path)
        .arg("--version")
        .output()
        .await
        .ok()
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_owned())
        .filter(|version| !version.is_empty());
    Ok(MongoshStatus {
        available: true,
        version,
    })
}

/// Starts mongosh for the connection's profile; output streams over `channel`.
#[tauri::command]
#[specta::specta]
pub async fn open_shell(
    state: State<'_, Arc<AppState>>,
    connection_id: ConnectionId,
    cols: u16,
    rows: u16,
    channel: Channel<ShellEvent>,
) -> Result<String, IpcError> {
    let mongosh = shell::locate_mongosh(None).ok_or(CoreError::NotFound("mongosh"))?;
    let credentials = profile_credentials(&state, connection_id).await?;

    let (tx, mut rx) = mpsc::channel::<ShellEvent>(64);
    let session = ShellSession::open(
        ShellOptions {
            mongosh: &mongosh,
            uri: &credentials.uri,
            password: credentials.password,
            cols,
            rows,
        },
        tx,
    )?;
    let id = uuid::Uuid::now_v7();
    state
        .shells
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .insert(id, (connection_id, session));

    let state = Arc::clone(&state);
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            let exited = matches!(event, ShellEvent::Exited { .. });
            // The UI is gone (tab closed, reload): end the session.
            if channel.send(event).is_err() || exited {
                break;
            }
        }
        if let Some((_, session)) = state
            .shells
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(&id)
        {
            session.close();
        }
    });
    Ok(id.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn shell_write(
    state: State<'_, Arc<AppState>>,
    id: String,
    data: String,
) -> Result<(), IpcError> {
    Ok(session(&state, &id)?.write(&data)?)
}

#[tauri::command]
#[specta::specta]
pub fn shell_resize(
    state: State<'_, Arc<AppState>>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), IpcError> {
    Ok(session(&state, &id)?.resize(cols, rows)?)
}

/// The UI rendered `bytes` of output (ADR-0030 credit-based flow control).
#[tauri::command]
#[specta::specta]
pub fn shell_ack(state: State<'_, Arc<AppState>>, id: String, bytes: u32) -> Result<(), IpcError> {
    session(&state, &id)?.acknowledge(bytes as usize);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn close_shell(state: State<'_, Arc<AppState>>, id: String) {
    if let Ok(id) = uuid::Uuid::parse_str(&id)
        && let Some((_, session)) = state
            .shells
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(&id)
    {
        session.close();
    }
}

fn session(state: &AppState, id: &str) -> Result<Arc<ShellSession>, CoreError> {
    let id = uuid::Uuid::parse_str(id).map_err(|_| CoreError::NotFound("shell session"))?;
    state
        .shells
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .get(&id)
        .map(|(_, session)| Arc::clone(session))
        .ok_or(CoreError::NotFound("shell session"))
}
