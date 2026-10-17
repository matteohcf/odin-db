use std::path::Path;
use std::sync::Arc;

use odin_core::connection::ConnectionManager;
use odin_core::operations::OperationRegistry;
use odin_core::query::CursorRegistry;
use odin_core::secrets::KeyringStore;
use odin_core::storage::Storage;
use specta_typescript::Typescript;
use tauri::{Manager, RunEvent, WindowEvent};
use tauri_specta::{Builder, collect_commands, collect_events};

mod backups;
mod commands;
mod events;
mod ipc;
mod quit;
mod state;

fn specta_builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new()
        .commands(collect_commands![
            commands::app::app_info,
            commands::app::confirm_quit,
            commands::profiles::list_profiles,
            commands::profiles::create_profile,
            commands::profiles::update_profile,
            commands::profiles::duplicate_profile,
            commands::profiles::export_connections,
            commands::profiles::import_connections,
            commands::profiles::delete_profile,
            commands::profiles::test_connection,
            commands::connections::connect,
            commands::connections::disconnect,
            commands::connections::list_connections,
            commands::connections::list_databases,
            commands::connections::list_collections,
            commands::connections::collection_stats,
            commands::documents::find_documents,
            commands::documents::fetch_more_documents,
            commands::documents::close_cursor,
            commands::documents::count_documents,
            commands::catalog::create_collection,
            commands::catalog::rename_collection,
            commands::catalog::drop_collection,
            commands::catalog::drop_database,
            commands::catalog::get_validation,
            commands::catalog::set_validation,
            commands::documents::sample_fields,
            commands::documents::explain_find,
            commands::documents::insert_document,
            commands::documents::replace_document,
            commands::documents::delete_document,
            commands::documents::distinct_values,
            commands::documents::update_documents,
            commands::documents::delete_documents,
            commands::documents::set_document_field,
            commands::documents::aggregate_documents,
            commands::documents::preview_aggregation,
            commands::indexes::list_indexes,
            commands::indexes::create_index,
            commands::indexes::drop_index,
            commands::indexes::set_index_hidden,
            commands::monitor::server_status,
            commands::monitor::current_ops,
            commands::monitor::kill_op,
            commands::transfer::export_documents,
            commands::transfer::choose_import_file,
            commands::transfer::import_documents,
            commands::transfer::export_database,
            commands::transfer::choose_import_folder,
            commands::transfer::import_database,
            commands::transfer::copy_data,
            commands::backup::database_tools_status,
            commands::backup::backup_database,
            commands::backup::choose_restore_source,
            commands::backup::restore_database,
            commands::backup::restore_contents,
            commands::backups::list_backup_runs,
            commands::backups::delete_backup_run,
            commands::backups::reveal_backup,
            commands::backups::restore_source_from_backup,
            commands::backups::list_backup_schedules,
            commands::backups::choose_backup_folder,
            commands::backups::save_backup_schedule,
            commands::backups::delete_backup_schedule,
            commands::backups::run_backup_schedule_now,
            commands::shell::mongosh_status,
            commands::shell::download_mongosh,
            commands::shell::open_shell,
            commands::shell::shell_write,
            commands::shell::shell_resize,
            commands::shell::shell_ack,
            commands::shell::close_shell,
            commands::operations::cancel_operation,
            commands::perf_lab::stream_sample_documents,
            commands::perf_lab::stream_terminal_output,
            commands::perf_lab::perf_autorun_enabled,
            commands::perf_lab::perf_autorun_finish,
            commands::perf_lab::perf_autorun_log,
        ])
        .events(collect_events![
            events::ConnectionHealthChanged,
            events::BackupsChanged,
            events::QuitRequested
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
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(Arc::new(OperationRegistry::default()))
        .manage(quit::QuitConfirmation::default())
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event
                && quit::hold_for_confirmation(window.app_handle())
            {
                api.prevent_close();
            }
        })
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            builder.mount_events(app);

            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let state = Arc::new(state::AppState {
                storage: Storage::open(&data_dir.join("odin-db.sqlite3"))?,
                secrets: Box::new(KeyringStore),
                connections: ConnectionManager::default(),
                cursors: CursorRegistry::default(),
                picked_files: std::sync::Mutex::default(),
                shells: std::sync::Mutex::default(),
                tools_dir: data_dir.join("tools"),
            });
            events::forward_health_changes(app.handle().clone(), &state);
            backups::spawn_scheduler(
                app.handle().clone(),
                Arc::clone(&state),
                commands::backup::tools,
            );
            app.manage(state);

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
        .build(tauri::generate_context!());

    match result {
        // Cmd+Q and the app menu's Quit skip the window's close request.
        Ok(app) => app.run(|app, event| {
            if let RunEvent::ExitRequested { api, .. } = event
                && quit::hold_for_confirmation(app)
            {
                api.prevent_exit();
            }
        }),
        Err(error) => {
            eprintln!("odin-db failed to start: {error}");
            std::process::exit(1);
        }
    }
}
