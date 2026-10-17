//! Milestone 0 benchmarks (ADR-0003): synthetic streams that exercise the real IPC path.

use std::io::Write;
use std::sync::Arc;

use odin_core::ejson::EJsonDocument;
use odin_core::operations::{OperationId, OperationRegistry};
use odin_core::synthetic::{self, DocumentStreamOptions, TerminalStreamOptions};
use tauri::State;
use tauri::ipc::Channel;

use crate::ipc::{StreamEvent, spawn_streaming_operation};

#[tauri::command]
#[specta::specta]
pub fn stream_sample_documents(
    registry: State<'_, Arc<OperationRegistry>>,
    options: DocumentStreamOptions,
    channel: Channel<StreamEvent<Vec<EJsonDocument>>>,
) -> OperationId {
    spawn_streaming_operation(&registry, channel, move |tx, cancel| {
        synthetic::stream_documents(options, tx, cancel)
    })
}

#[tauri::command]
#[specta::specta]
pub fn stream_terminal_output(
    registry: State<'_, Arc<OperationRegistry>>,
    options: TerminalStreamOptions,
    channel: Channel<StreamEvent<String>>,
) -> OperationId {
    spawn_streaming_operation(&registry, channel, move |tx, cancel| {
        synthetic::stream_terminal_output(options, tx, cancel)
    })
}

const AUTORUN_FLAG: &str = "--perf-autorun";

pub(crate) fn autorun_requested() -> bool {
    std::env::args().any(|arg| arg == AUTORUN_FLAG)
}

/// True when the app was started with `--perf-autorun`: the UI runs every
/// benchmark unattended, reports, and exits.
#[tauri::command]
#[specta::specta]
pub fn perf_autorun_enabled() -> bool {
    autorun_requested()
}

/// Prints the benchmark report to stdout and exits. Ignored outside autorun mode.
#[tauri::command]
#[specta::specta]
pub fn perf_autorun_finish(app: tauri::AppHandle, report: String) {
    if !autorun_requested() {
        return;
    }
    let mut stdout = std::io::stdout();
    // Nothing useful to do if stdout is closed; the exit code still reports success.
    let _ = writeln!(stdout, "{report}").and_then(|()| stdout.flush());
    app.exit(0);
}

/// Progress line on stderr so an unattended run that stalls can be diagnosed.
#[tauri::command]
#[specta::specta]
pub fn perf_autorun_log(message: String) {
    if autorun_requested() {
        let _ = writeln!(std::io::stderr(), "[perf-autorun] {message}");
    }
}
