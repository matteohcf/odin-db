//! Files dragged onto the window (ADR-0051). Paths stay here: the UI gets opaque tokens, as for
//! files picked in a dialog.

use std::sync::Arc;

use tauri::{AppHandle, DragDropEvent, Manager};
use tauri_specta::Event;

use crate::commands::backup::remember_path;
use crate::events::{DroppedFile, FileDragChanged, FilesDropped};
use crate::state::AppState;

#[expect(
    clippy::wildcard_enum_match_arm,
    reason = "tauri's DragDropEvent is non-exhaustive; Over and future events need nothing"
)]
pub fn on_drag_drop(app: &AppHandle, event: &DragDropEvent) {
    match event {
        DragDropEvent::Enter { .. } => {
            let _ = FileDragChanged { hovering: true }.emit(app);
        }
        DragDropEvent::Leave => {
            let _ = FileDragChanged { hovering: false }.emit(app);
        }
        DragDropEvent::Drop { paths, .. } => {
            let _ = FileDragChanged { hovering: false }.emit(app);
            // Managed in `setup`, before the window can receive anything.
            let Some(state) = app.try_state::<Arc<AppState>>() else {
                return;
            };
            let files = paths
                .iter()
                .map(|path| DroppedFile {
                    name: path
                        .file_name()
                        .map(|name| name.to_string_lossy().into_owned())
                        .unwrap_or_default(),
                    directory: path.is_dir(),
                    token: remember_path(&state, path.clone()),
                })
                .collect();
            let _ = FilesDropped { files }.emit(app);
        }
        _ => {}
    }
}
