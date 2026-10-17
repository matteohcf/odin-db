use serde::Serialize;

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: String,
    pub tauri_version: String,
    pub webview_version: String,
    pub os: String,
    pub arch: String,
}

#[tauri::command]
#[specta::specta]
pub fn app_info() -> AppInfo {
    AppInfo {
        version: env!("CARGO_PKG_VERSION").to_owned(),
        tauri_version: tauri::VERSION.to_owned(),
        webview_version: tauri::webview_version().unwrap_or_else(|_| "unknown".to_owned()),
        os: std::env::consts::OS.to_owned(),
        arch: std::env::consts::ARCH.to_owned(),
    }
}

/// Quits after the user confirmed: cancels running operations and gives them a
/// moment to clean up (exports delete their partial file) before exiting.
#[tauri::command]
#[specta::specta]
pub async fn confirm_quit(
    app: tauri::AppHandle,
    confirmation: tauri::State<'_, crate::quit::QuitConfirmation>,
    registry: tauri::State<'_, std::sync::Arc<odin_core::operations::OperationRegistry>>,
) -> Result<(), crate::ipc::IpcError> {
    confirmation.confirm();
    registry.cancel_all();
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
    while registry.running() > 0 && std::time::Instant::now() < deadline {
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    app.exit(0);
    Ok(())
}
