//! Quitting while operations run asks the user first (ADR-0024).

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use odin_core::operations::OperationRegistry;
use tauri::{AppHandle, Manager};
use tauri_specta::Event;

use crate::events::QuitRequested;

/// Set once the user confirmed, so the exit that follows goes through.
#[derive(Debug, Default)]
pub struct QuitConfirmation(AtomicBool);

impl QuitConfirmation {
    pub fn confirm(&self) {
        self.0.store(true, Ordering::SeqCst);
    }
}

/// Whether a close or exit request must wait for the user. If so, asks the UI.
pub fn hold_for_confirmation(app: &AppHandle) -> bool {
    let confirmed = app
        .try_state::<QuitConfirmation>()
        .is_some_and(|confirmation| confirmation.0.load(Ordering::SeqCst));
    if confirmed {
        return false;
    }
    let operations = app
        .try_state::<Arc<OperationRegistry>>()
        .map_or(0, |registry| registry.running());
    if operations == 0 {
        return false;
    }
    let _ = QuitRequested {
        operations: u32::try_from(operations).unwrap_or(u32::MAX),
    }
    .emit(app);
    true
}
