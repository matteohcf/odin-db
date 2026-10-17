use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use odin_core::CoreError;
use odin_core::connection::{ConnectionId, ConnectionManager};
use odin_core::query::CursorRegistry;
use odin_core::secrets::SecretStore;
use odin_core::shell::ShellSession;
use odin_core::storage::Storage;

/// Long-lived backend state shared by all commands.
pub struct AppState {
    pub storage: Storage,
    pub secrets: Box<dyn SecretStore>,
    pub connections: ConnectionManager,
    pub cursors: CursorRegistry,
    /// Files the user picked (imports, restores), by opaque token: paths never reach the webview.
    pub picked_files: Mutex<HashMap<uuid::Uuid, PathBuf>>,
    /// Open mongosh sessions and the connection each belongs to.
    pub shells: Mutex<HashMap<uuid::Uuid, (ConnectionId, Arc<ShellSession>)>>,
    /// Where tools downloaded by the app (mongosh) are installed.
    pub tools_dir: PathBuf,
}

impl AppState {
    /// Ends the shells of a connection that is closing.
    pub fn close_shells_for(&self, connection: ConnectionId) {
        let mut shells = self
            .shells
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        shells.retain(|_, (owner, session)| {
            let keep = *owner != connection;
            if !keep {
                session.close();
            }
            keep
        });
    }
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

/// What external tools (mongodump, mongosh) need to connect as a profile:
/// the sanitized URI and the password from the keyring.
pub struct Credentials {
    pub uri: String,
    pub password: Option<odin_core::secrets::Secret>,
    pub read_only: bool,
}

pub async fn profile_credentials(
    state: &Arc<AppState>,
    connection_id: ConnectionId,
) -> Result<Credentials, CoreError> {
    let handle = state.connections.get(connection_id).await?;
    let profile_id = handle.info.profile_id;
    let read_only = handle.info.read_only;
    blocking(state, move |s| {
        let profile = odin_core::profiles::get(&s.storage, s.secrets.as_ref(), profile_id)?;
        Ok(Credentials {
            uri: profile.connection_string,
            password: s.secrets.password(profile_id)?,
            read_only,
        })
    })
    .await
}
