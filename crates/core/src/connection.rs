//! Live connections: one shared `mongodb::Client` per connected profile (ADR-0008).

use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use bson::doc;
use mongodb::Client;
use mongodb::ServerType;
use mongodb::event::EventHandler;
use mongodb::event::sdam::SdamEvent;
use mongodb::options::ClientOptions;
use serde::{Deserialize, Serialize};
use tokio::sync::{RwLock, broadcast};
use uuid::Uuid;

use crate::CoreError;
use crate::profiles::{ConnectionProfile, ProfileId};
use crate::secrets::Secret;
use crate::ssh::{SshSettings, SshTunnel, open_tunnel, tunnel_target, tunneled_uri};

const DEFAULT_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(transparent)]
pub struct ConnectionId(Uuid);

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ConnectionInfo {
    pub id: ConnectionId,
    pub profile_id: ProfileId,
    pub server_version: String,
    pub read_only: bool,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ServerInfo {
    pub server_version: String,
}

/// A connection whose servers stopped (or started again) answering heartbeats.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct HealthChange {
    pub connection_id: ConnectionId,
    pub reachable: bool,
}

/// Shared with the driver's event callback, which runs on driver threads.
#[derive(Debug, Default)]
struct Health {
    /// Off until the connection is established and after it is closed, so the
    /// topology churn of opening and shutting down is not reported.
    armed: AtomicBool,
    reachable: AtomicBool,
}

#[derive(Debug)]
pub struct ConnectionHandle {
    pub info: ConnectionInfo,
    pub client: Client,
    health: Arc<Health>,
    /// The connection string actually used, without the password: through
    /// the SSH tunnel when there is one. Tools such as mongosh get this one.
    pub uri: String,
    /// Kept for the connection's lifetime; dropping it closes the tunnel.
    _tunnel: Option<SshTunnel>,
}

/// How to reach a server: directly, or through an SSH bastion.
#[derive(Debug, Clone, Copy)]
pub struct SshRoute<'a> {
    pub settings: &'a SshSettings,
    pub secret: Option<&'a Secret>,
    /// The trusted host key fingerprint, if any yet.
    pub pinned: Option<&'a str>,
}

/// Opens the SSH tunnel when needed. Returns the connection string to use,
/// and the tunnel to keep alive while using it.
pub async fn route(
    connection_string: &str,
    ssh: Option<SshRoute<'_>>,
) -> Result<(String, Option<SshTunnel>), CoreError> {
    let Some(ssh) = ssh else {
        return Ok((connection_string.to_owned(), None));
    };
    let target = tunnel_target(connection_string)?;
    let tunnel = open_tunnel(ssh.settings, ssh.secret, ssh.pinned, target).await?;
    let uri = tunneled_uri(connection_string, tunnel.local_port)?;
    Ok((uri, Some(tunnel)))
}

impl ConnectionHandle {
    /// Enforces read-only profiles in the backend, whatever the UI shows (ADR-0017).
    pub fn ensure_writable(&self) -> Result<(), CoreError> {
        if self.info.read_only {
            Err(CoreError::ReadOnly)
        } else {
            Ok(())
        }
    }
}

#[derive(Debug)]
pub struct ConnectionManager {
    connections: RwLock<HashMap<ConnectionId, Arc<ConnectionHandle>>>,
    health: broadcast::Sender<HealthChange>,
}

impl Default for ConnectionManager {
    fn default() -> Self {
        Self {
            connections: RwLock::default(),
            health: broadcast::channel(64).0,
        }
    }
}

impl ConnectionManager {
    /// Reachability changes of every open connection, as the driver's heartbeats see them.
    pub fn health_changes(&self) -> broadcast::Receiver<HealthChange> {
        self.health.subscribe()
    }

    /// Opens a connection for `profile`, or returns the existing one.
    pub async fn connect(
        &self,
        profile: &ConnectionProfile,
        password: Option<Secret>,
        ssh_secret: Option<Secret>,
    ) -> Result<ConnectionInfo, CoreError> {
        if let Some(existing) = self.find_by_profile(profile.id).await {
            return Ok(existing.info.clone());
        }

        let id = ConnectionId(Uuid::now_v7());
        let health = Arc::new(Health::default());
        let handler = health_handler(id, Arc::clone(&health), self.health.clone());
        let ssh = profile.ssh.as_ref().map(|settings| SshRoute {
            settings,
            secret: ssh_secret.as_ref(),
            pinned: profile.ssh_host_key.as_deref(),
        });
        let (uri, tunnel) = route(&profile.connection_string, ssh).await?;
        let client = open_client(&uri, password, Some(handler)).await?;
        let server_version = server_version(&client).await?;
        health.reachable.store(true, Ordering::SeqCst);
        health.armed.store(true, Ordering::SeqCst);
        let info = ConnectionInfo {
            id,
            profile_id: profile.id,
            server_version,
            read_only: profile.read_only,
        };
        let handle = Arc::new(ConnectionHandle {
            info: info.clone(),
            client,
            health,
            uri,
            _tunnel: tunnel,
        });
        let mut connections = self.connections.write().await;
        // A concurrent connect to the same profile may have finished first: keep that one.
        if let Some(existing) = connections
            .values()
            .find(|other| other.info.profile_id == profile.id)
            .map(|other| other.info.clone())
        {
            drop(connections);
            handle.health.armed.store(false, Ordering::SeqCst);
            handle.client.clone().shutdown().await;
            return Ok(existing);
        }
        connections.insert(info.id, handle);
        Ok(info)
    }

    pub async fn disconnect(&self, id: ConnectionId) -> Result<(), CoreError> {
        let handle = self
            .connections
            .write()
            .await
            .remove(&id)
            .ok_or(CoreError::NotConnected)?;
        handle.health.armed.store(false, Ordering::SeqCst);
        handle.client.clone().shutdown().await;
        Ok(())
    }

    pub async fn get(&self, id: ConnectionId) -> Result<Arc<ConnectionHandle>, CoreError> {
        self.connections
            .read()
            .await
            .get(&id)
            .cloned()
            .ok_or(CoreError::NotConnected)
    }

    pub async fn list(&self) -> Vec<ConnectionInfo> {
        self.connections
            .read()
            .await
            .values()
            .map(|handle| handle.info.clone())
            .collect()
    }

    pub async fn find_by_profile(&self, profile: ProfileId) -> Option<Arc<ConnectionHandle>> {
        self.connections
            .read()
            .await
            .values()
            .find(|handle| handle.info.profile_id == profile)
            .cloned()
    }
}

/// Connects without registering anything, to validate a profile before saving it.
pub async fn test_connection(
    connection_string: &str,
    password: Option<Secret>,
    ssh: Option<SshRoute<'_>>,
) -> Result<ServerInfo, CoreError> {
    let (uri, _tunnel) = route(connection_string, ssh).await?;
    let client = open_client(&uri, password, None).await?;
    let result = server_version(&client).await;
    client.shutdown().await;
    Ok(ServerInfo {
        server_version: result?,
    })
}

/// Reports a change whenever the topology goes from "some server answers" to
/// "none answers", or back.
fn health_handler(
    id: ConnectionId,
    health: Arc<Health>,
    sender: broadcast::Sender<HealthChange>,
) -> EventHandler<SdamEvent> {
    EventHandler::callback(move |event| {
        let SdamEvent::TopologyDescriptionChanged(change) = event else {
            return;
        };
        let reachable = change
            .new_description
            .servers()
            .values()
            .any(|server| server.server_type() != ServerType::Unknown);
        if health.armed.load(Ordering::SeqCst)
            && health.reachable.swap(reachable, Ordering::SeqCst) != reachable
        {
            // Nobody listening (no window yet) is fine.
            let _ = sender.send(HealthChange {
                connection_id: id,
                reachable,
            });
        }
    })
}

async fn open_client(
    connection_string: &str,
    password: Option<Secret>,
    health: Option<EventHandler<SdamEvent>>,
) -> Result<Client, CoreError> {
    let mut options = ClientOptions::parse(connection_string).await?;
    options.app_name = Some("odin-db".into());
    options.sdam_event_handler = health;
    options
        .server_selection_timeout
        .get_or_insert(DEFAULT_TIMEOUT);
    options.connect_timeout.get_or_insert(DEFAULT_TIMEOUT);

    if let Some(password) = password {
        let credential = options.credential.as_mut().ok_or_else(|| {
            CoreError::Validation("a password requires a username in the connection string".into())
        })?;
        credential.password = Some(password.expose().to_owned());
    }
    Ok(Client::with_options(options)?)
}

async fn server_version(client: &Client) -> Result<String, CoreError> {
    let info = client
        .database("admin")
        .run_command(doc! { "buildInfo": 1 })
        .await?;
    Ok(info.get_str("version").unwrap_or("unknown").to_owned())
}
