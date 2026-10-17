use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use odin_core::CoreError;
use odin_core::connection::{ConnectionId, ConnectionManager};
use odin_core::profiles::ProfileId;
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
/// the sanitized URI (through the SSH tunnel, if any) and the password.
pub struct Credentials {
    pub profile_id: ProfileId,
    pub uri: String,
    pub password: Option<odin_core::secrets::Secret>,
    pub read_only: bool,
    /// A tunnel opened just for these credentials, closed when they are dropped.
    _tunnel: Option<odin_core::ssh::SshTunnel>,
}

/// Credentials of an open connection: tools reuse its tunnel.
pub async fn profile_credentials(
    state: &Arc<AppState>,
    connection_id: ConnectionId,
) -> Result<Credentials, CoreError> {
    let handle = state.connections.get(connection_id).await?;
    let profile_id = handle.info.profile_id;
    let password = blocking(state, move |s| s.secrets.password(profile_id)).await?;
    Ok(Credentials {
        profile_id,
        uri: handle.uri.clone(),
        password,
        read_only: handle.info.read_only,
        _tunnel: None,
    })
}

/// Credentials for a profile whether or not it is connected (scheduled
/// backups run on their own): an open connection's tunnel is reused,
/// otherwise one is opened for as long as the credentials live.
pub async fn credentials_for_profile(
    state: &Arc<AppState>,
    profile_id: ProfileId,
) -> Result<Credentials, CoreError> {
    if let Some(handle) = state.connections.find_by_profile(profile_id).await {
        return profile_credentials(state, handle.info.id).await;
    }
    let (profile, password, ssh_secret) = blocking(state, move |s| {
        let profile = odin_core::profiles::get(&s.storage, s.secrets.as_ref(), profile_id)?;
        Ok((
            profile,
            s.secrets.password(profile_id)?,
            s.secrets.ssh_secret(profile_id)?,
        ))
    })
    .await?;
    let ssh = profile
        .ssh
        .as_ref()
        .map(|settings| odin_core::connection::SshRoute {
            settings,
            secret: ssh_secret.as_ref(),
            pinned: profile.ssh_host_key.as_deref(),
        });
    let (uri, tunnel) = odin_core::connection::route(&profile.connection_string, ssh).await?;
    Ok(Credentials {
        profile_id,
        uri,
        password,
        read_only: profile.read_only,
        _tunnel: tunnel,
    })
}
