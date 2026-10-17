use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use odin_core::CoreError;
use odin_core::connection::ConnectionManager;
use odin_core::query::CursorRegistry;
use odin_core::secrets::SecretStore;
use odin_core::storage::Storage;

/// Long-lived backend state shared by all commands.
pub struct AppState {
    pub storage: Storage,
    pub secrets: Box<dyn SecretStore>,
    pub connections: ConnectionManager,
    pub cursors: CursorRegistry,
    /// Files the user picked for import, by opaque token: paths never reach the webview.
    pub import_files: Mutex<HashMap<uuid::Uuid, PathBuf>>,
}

/// SQLite and the OS keyring block (the keyring may even show a system prompt),
/// so their calls run on the blocking pool, never on an async worker.
pub async fn blocking<T, F>(state: &Arc<AppState>, work: F) -> Result<T, CoreError>
where
    T: Send + 'static,
    F: FnOnce(&AppState) -> Result<T, CoreError> + Send + 'static,
{
    let state = Arc::clone(state);
    tauri::async_runtime::spawn_blocking(move || work(&state))
        .await
        .map_err(|error| CoreError::Internal(error.to_string()))?
}
