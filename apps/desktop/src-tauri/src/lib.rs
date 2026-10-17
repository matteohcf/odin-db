use std::path::Path;
use std::sync::Arc;

use odin_core::operations::OperationRegistry;
use specta_typescript::Typescript;
use tauri::Manager;
use tauri_specta::{Builder, collect_commands};

mod commands;
mod ipc;

fn specta_builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new().commands(collect_commands![
        commands::app::app_info,
        commands::operations::cancel_operation,
        commands::perf_lab::stream_sample_documents,
        commands::perf_lab::stream_terminal_output,
        commands::perf_lab::perf_autorun_enabled,
        commands::perf_lab::perf_autorun_finish,
        commands::perf_lab::perf_autorun_log,
    ])
}

pub fn export_bindings(path: &Path) -> Result<(), String> {
    specta_builder()
        .export(Typescript::default(), path)
        .map_err(|error| error.to_string())
}

pub fn run() {
    let builder = specta_builder();

    let result = tauri::Builder::default()
        .manage(Arc::new(OperationRegistry::default()))
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            builder.mount_events(app);
            // Webviews throttle animation frames in occluded windows, which would
            // stall frame-based benchmarks: keep the window visible during autorun.
            if commands::perf_lab::autorun_requested()
                && let Some(window) = app.get_webview_window("main")
            {
                let _ = window.set_always_on_top(true);
                let _ = window.set_focus();
            }
            Ok(())
        })
        .run(tauri::generate_context!());

    if let Err(error) = result {
        eprintln!("odin-db failed to start: {error}");
        std::process::exit(1);
    }
}
