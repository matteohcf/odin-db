use std::sync::Arc;

use odin_core::CoreError;
use odin_core::operations::{OperationId, OperationRegistry};
use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, State};
use tauri_plugin_updater::UpdaterExt;

use crate::ipc::{IpcError, StreamEvent, spawn_streaming_operation};

/// A newer release than the running one.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub current_version: String,
    pub notes: Option<String>,
    pub date: Option<String>,
}

/// Bytes of the update downloaded so far; `total` is unknown for some servers.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProgress {
    pub done: f64,
    pub total: Option<f64>,
}

fn updater_error(error: impl std::fmt::Display) -> CoreError {
    CoreError::Internal(format!("update check failed: {error}"))
}

/// Asks the release server for a newer, signed version. `None` when up to date.
#[tauri::command]
#[specta::specta]
pub async fn check_for_update(app: AppHandle) -> Result<Option<UpdateInfo>, IpcError> {
    let update = app
        .updater()
        .map_err(updater_error)?
        .check()
        .await
        .map_err(updater_error)?;
    Ok(update.map(|update| UpdateInfo {
        version: update.version,
        current_version: update.current_version,
        notes: update.body,
        date: update.date.map(|date| date.to_string()),
    }))
}

/// Downloads the update, verifies its signature, installs it and restarts the app.
/// A long operation: progress is streamed and it can be cancelled until installing.
#[tauri::command]
#[specta::specta]
pub async fn install_update(
    app: AppHandle,
    registry: State<'_, Arc<OperationRegistry>>,
    channel: Channel<StreamEvent<UpdateProgress>>,
) -> Result<OperationId, IpcError> {
    Ok(spawn_streaming_operation(
        &registry,
        channel,
        move |tx, cancel| async move {
            let update = app
                .updater()
                .map_err(updater_error)?
                .check()
                .await
                .map_err(updater_error)?
                .ok_or_else(|| CoreError::Validation("odin-db is already up to date".into()))?;
            let mut done: u64 = 0;
            let download = update.download_and_install(
                |chunk, total| {
                    done += chunk as u64;
                    #[allow(clippy::cast_precision_loss)]
                    let _ = tx.try_send(UpdateProgress {
                        done: done as f64,
                        total: total.map(|total| total as f64),
                    });
                },
                || {},
            );
            tokio::select! {
                result = download => result.map_err(updater_error)?,
                () = cancel.cancelled() => return Err(CoreError::Cancelled),
            }
            app.restart();
        },
    ))
}
