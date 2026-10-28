//! One odin-db process per desktop session (ADR-0061): a second launch focuses the running window
//! and exits, so the backup scheduler and the local store are never shared by two processes.

use tauri::{AppHandle, Manager};

/// Brings the main window to the front, wherever it was left: minimized, hidden or behind others.
pub fn focus_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}
