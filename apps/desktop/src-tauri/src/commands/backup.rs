//! Backup and restore with MongoDB Database Tools (ADR-0015).

use std::path::PathBuf;
use std::sync::{Arc, PoisonError};

use odin_core::CoreError;
use odin_core::backup::{
    self, BackupRequest, BackupScope, DatabaseTools, RestoreRequest, RestoreSource, ToolConnection,
    ToolEvent, ToolSummary, ToolsStatus,
};
use odin_core::connection::ConnectionId;
use odin_core::operations::{OperationId, OperationRegistry};
use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::backups::{BackupJob, run_backup};
use crate::ipc::{IpcError, StreamEvent, spawn_streaming_operation};
use crate::state::{AppState, Credentials, profile_credentials};

/// Tool output, then exactly one `finished` with the totals.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
pub enum BackupEvent {
    Output(ToolEvent),
    Finished(ToolSummary),
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PickedFile {
    /// Opaque handle for `restore_database`; the path stays in the backend.
    pub token: String,
    pub name: String,
}

/// Bundled sidecars live next to the executable; otherwise the user's `PATH` is used.
pub(crate) fn tools() -> Option<DatabaseTools> {
    let bundled = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(PathBuf::from));
    backup::locate_tools(bundled.as_deref())
}

pub(crate) fn require_tools() -> Result<DatabaseTools, CoreError> {
    tools().ok_or(CoreError::NotFound(
        "MongoDB Database Tools (mongodump and mongorestore)",
    ))
}

#[tauri::command]
#[specta::specta]
pub async fn database_tools_status() -> Result<ToolsStatus, IpcError> {
    let Some(tools) = tools() else {
        return Ok(ToolsStatus {
            available: false,
            version: None,
        });
    };
    Ok(ToolsStatus {
        available: true,
        version: backup::tools_version(&tools).await,
    })
}

/// Asks where to save the archive, then runs mongodump. `None` if the user cancels.
#[tauri::command]
#[specta::specta]
pub async fn backup_database(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    registry: State<'_, Arc<OperationRegistry>>,
    connection_id: ConnectionId,
    request: BackupRequest,
    channel: Channel<StreamEvent<BackupEvent>>,
) -> Result<Option<OperationId>, IpcError> {
    let tools = require_tools()?;
    let credentials = profile_credentials(&state, connection_id).await?;
    let stem = match &request.scope {
        BackupScope::Deployment => "mongodb".to_owned(),
        BackupScope::Database { database } => database.clone(),
        BackupScope::Collection {
            database,
            collection,
        } => format!("{database}.{collection}"),
    };
    let extension = if request.gzip {
        "archive.gz"
    } else {
        "archive"
    };
    let dialog = app
        .dialog()
        .file()
        .set_file_name(format!("{stem}.{extension}"))
        .add_filter("MongoDB archive", &["gz", "archive"]);
    let Some(path) = tauri::async_runtime::spawn_blocking(move || dialog.blocking_save_file())
        .await
        .map_err(|error| CoreError::Internal(error.to_string()))?
    else {
        return Ok(None);
    };
    let path = path
        .into_path()
        .map_err(|error| CoreError::Validation(error.to_string()))?;

    let job = BackupJob {
        profile_id: credentials.profile_id,
        schedule: None,
        request,
        archive: path,
    };
    let state = Arc::clone(&state);
    Ok(Some(spawn_streaming_operation(
        &registry,
        channel,
        move |tx, cancel| async move {
            let output = forward_output(tx.clone());
            let summary = run_backup(&app, &state, &tools, job, output, cancel).await?;
            let _ = tx.send(BackupEvent::Finished(summary)).await;
            Ok(())
        },
    )))
}

/// Asks for an archive file or a dump directory. `None` if the user cancels.
#[tauri::command]
#[specta::specta]
pub async fn choose_restore_source(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    source: RestoreSource,
) -> Result<Option<PickedFile>, IpcError> {
    let dialog = app.dialog().file();
    let picked = tauri::async_runtime::spawn_blocking(move || match source {
        RestoreSource::Archive => dialog
            .add_filter("MongoDB archive", &["gz", "archive"])
            .blocking_pick_file(),
        RestoreSource::Directory => dialog.blocking_pick_folder(),
    })
    .await
    .map_err(|error| CoreError::Internal(error.to_string()))?;
    let Some(path) = picked else { return Ok(None) };
    let path = path
        .into_path()
        .map_err(|error| CoreError::Validation(error.to_string()))?;
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    Ok(Some(PickedFile {
        token: remember_path(&state, path),
        name,
    }))
}

/// The path behind a token from a dialog or a drop; `what` names it in the error.
pub(crate) fn picked_path(
    state: &AppState,
    token: &str,
    what: &'static str,
) -> Result<PathBuf, CoreError> {
    let token = uuid::Uuid::parse_str(token).map_err(|_| CoreError::NotFound(what))?;
    state
        .picked_files
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .get(&token)
        .cloned()
        .ok_or(CoreError::NotFound(what))
}

/// Tokens kept at most; drops nobody uses would otherwise pile up for the whole session.
const MAX_PICKED: usize = 256;

/// Keeps a path in the backend and returns the opaque token the UI uses for it.
pub(crate) fn remember_path(state: &AppState, path: PathBuf) -> String {
    let token = uuid::Uuid::now_v7();
    let mut picked = state
        .picked_files
        .lock()
        .unwrap_or_else(PoisonError::into_inner);
    // Version 7 ids sort by creation time: the smallest is the oldest pick.
    while picked.len() >= MAX_PICKED {
        let Some(oldest) = picked.keys().min().copied() else {
            break;
        };
        picked.remove(&oldest);
    }
    picked.insert(token, path);
    token.to_string()
}

/// What a picked backup contains (`db.collection` names), read without writing.
#[tauri::command]
#[specta::specta]
pub async fn restore_contents(
    state: State<'_, Arc<AppState>>,
    connection_id: ConnectionId,
    token: String,
    source: RestoreSource,
) -> Result<Vec<String>, IpcError> {
    let tools = require_tools()?;
    let credentials = profile_credentials(&state, connection_id).await?;
    let token = uuid::Uuid::parse_str(&token).map_err(|_| CoreError::NotFound("restore source"))?;
    let path = state
        .picked_files
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .get(&token)
        .cloned()
        .ok_or(CoreError::NotFound("restore source"))?;
    let connection = tool_connection(&credentials);
    Ok(backup::archive_contents(&tools, connection, source, &path).await?)
}

#[tauri::command]
#[specta::specta]
pub async fn restore_database(
    state: State<'_, Arc<AppState>>,
    registry: State<'_, Arc<OperationRegistry>>,
    connection_id: ConnectionId,
    token: String,
    request: RestoreRequest,
    channel: Channel<StreamEvent<BackupEvent>>,
) -> Result<OperationId, IpcError> {
    let tools = require_tools()?;
    let credentials = profile_credentials(&state, connection_id).await?;
    if credentials.read_only {
        return Err(CoreError::ReadOnly.into());
    }
    let token = uuid::Uuid::parse_str(&token).map_err(|_| CoreError::NotFound("restore source"))?;
    let path = state
        .picked_files
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .remove(&token)
        .ok_or(CoreError::NotFound("restore source"))?;

    Ok(spawn_streaming_operation(
        &registry,
        channel,
        move |tx, cancel| async move {
            let output = forward_output(tx.clone());
            let connection = tool_connection(&credentials);
            let summary =
                backup::restore(&tools, connection, &request, &path, output, cancel).await?;
            let _ = tx.send(BackupEvent::Finished(summary)).await;
            Ok(())
        },
    ))
}

fn forward_output(
    tx: tokio::sync::mpsc::Sender<BackupEvent>,
) -> tokio::sync::mpsc::Sender<ToolEvent> {
    let (output_tx, mut output_rx) = tokio::sync::mpsc::channel(64);
    tauri::async_runtime::spawn(async move {
        while let Some(event) = output_rx.recv().await {
            if tx.send(BackupEvent::Output(event)).await.is_err() {
                break;
            }
        }
    });
    output_tx
}

fn tool_connection(credentials: &Credentials) -> ToolConnection<'_> {
    ToolConnection {
        uri: &credentials.uri,
        password: credentials.password.as_ref(),
        read_only: credentials.read_only,
    }
}
