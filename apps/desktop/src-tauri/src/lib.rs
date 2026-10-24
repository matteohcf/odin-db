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
mod drops;
mod events;
mod ipc;
mod quit;
mod state;

// One list of every command: long by nature, and clearer whole than split.
#[allow(clippy::too_many_lines)]
fn specta_builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new()
        .commands(collect_commands![
            commands::app::app_info,
            commands::app::confirm_quit,
            commands::app::notify_if_unfocused,
            commands::app::open_link,
            commands::ai::ai_overview,
            commands::ai::download_ai_model,
            commands::ai::delete_ai_model,
            commands::ai::unload_ai_model,
            commands::ai::list_ollama_models,
            commands::ai::generate_query,
            commands::compare::compare_collections,
            commands::search::search_values,
            commands::compare::compare_schemas,
            commands::diagram::database_diagram,
            commands::diagram::save_diagram_image,
            commands::compare::compared_pair,
            commands::compare::sync_collections,
            commands::updates::check_for_update,
            commands::updates::install_update,
            commands::profiles::list_profiles,
            commands::profiles::create_profile,
            commands::profiles::update_profile,
            commands::profiles::duplicate_profile,
            commands::profiles::trust_ssh_host_key,
            commands::profiles::choose_ssh_key,
            commands::profiles::export_connections,
            commands::profiles::choose_connections_file,
            commands::profiles::import_connections,
            commands::profiles::delete_profile,
            commands::profiles::test_connection,
            commands::connections::connect,
            commands::connections::disconnect,
            commands::connections::list_connections,
            commands::connections::list_databases,
            commands::connections::list_collections,
            commands::connections::list_catalog,
            commands::connections::collection_stats,
            commands::connections::collection_counts,
            commands::documents::watch_changes,
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
            commands::documents::change_field,
            commands::documents::delete_documents,
            commands::documents::set_document_field,
            commands::documents::unset_document_field,
            commands::gridfs::download_gridfs_file,
            commands::gridfs::upload_gridfs_file,
            commands::documents::aggregate_documents,
            commands::documents::preview_aggregation,
            commands::indexes::index_advice,
            commands::indexes::list_indexes,
            commands::indexes::create_index,
            commands::indexes::drop_index,
            commands::indexes::set_index_hidden,
            commands::monitor::server_status,
            commands::monitor::replica_set_status,
            commands::monitor::profiling_status,
            commands::monitor::set_profiling_status,
            commands::monitor::profile_entries,
            commands::monitor::current_ops,
            commands::monitor::kill_op,
            commands::users::list_users,
            commands::users::list_roles,
            commands::users::create_user,
            commands::users::set_user_roles,
            commands::users::change_user_password,
            commands::users::drop_user,
            commands::transfer::export_documents,
            commands::transfer::choose_import_file,
            commands::transfer::import_file_from_drop,
            commands::transfer::import_documents,
            commands::transfer::export_database,
            commands::transfer::choose_import_folder,
            commands::transfer::import_folder_from_drop,
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
            events::QuitRequested,
            events::FileDragChanged,
            events::FilesDropped
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
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(Arc::new(OperationRegistry::default()))
        .manage(quit::QuitConfirmation::default())
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event
                && quit::hold_for_confirmation(window.app_handle())
            {
                api.prevent_close();
            }
            if let WindowEvent::DragDrop(drop) = event {
                drops::on_drag_drop(window.app_handle(), drop);
            }
        })
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            builder.mount_events(app);

            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let state = Arc::new(state::AppState {
                storage: Storage::open(&data_dir.join("odin-db.sqlite3"))?,
                secrets: Box::new(KeyringStore::default()),
                connections: ConnectionManager::default(),
                cursors: CursorRegistry::default(),
                picked_files: std::sync::Mutex::default(),
                shells: std::sync::Mutex::default(),
                tools_dir: data_dir.join("tools"),
            });
            app.manage(odin_ai::engine::Assistant::new(
                odin_ai::store::ModelStore::new(data_dir.join("models")),
            ));
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
