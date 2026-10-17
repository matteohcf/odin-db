//! Live connections: one shared `mongodb::Client` per connected profile (ADR-0008).

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use bson::doc;
use mongodb::Client;
use mongodb::options::ClientOptions;
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::CoreError;
use crate::profiles::{ConnectionProfile, ProfileId};
use crate::secrets::Secret;

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

#[derive(Debug)]
pub struct ConnectionHandle {
    pub info: ConnectionInfo,
    pub client: Client,
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

#[derive(Debug, Default)]
pub struct ConnectionManager {
    connections: RwLock<HashMap<ConnectionId, Arc<ConnectionHandle>>>,
}

impl ConnectionManager {
    /// Opens a connection for `profile`, or returns the existing one.
    pub async fn connect(
        &self,
        profile: &ConnectionProfile,
        password: Option<Secret>,
    ) -> Result<ConnectionInfo, CoreError> {
        if let Some(existing) = self.find_by_profile(profile.id).await {
            return Ok(existing.info.clone());
        }

        let client = open_client(&profile.connection_string, password).await?;
        let server_version = server_version(&client).await?;
        let info = ConnectionInfo {
            id: ConnectionId(Uuid::now_v7()),
            profile_id: profile.id,
            server_version,
            read_only: profile.read_only,
        };
        let handle = Arc::new(ConnectionHandle {
            info: info.clone(),
            client,
        });
        self.connections.write().await.insert(info.id, handle);
        Ok(info)
    }

    pub async fn disconnect(&self, id: ConnectionId) -> Result<(), CoreError> {
        let handle = self
            .connections
            .write()
            .await
            .remove(&id)
            .ok_or(CoreError::NotConnected)?;
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
) -> Result<ServerInfo, CoreError> {
    let client = open_client(connection_string, password).await?;
    let result = server_version(&client).await;
    client.shutdown().await;
    Ok(ServerInfo {
        server_version: result?,
    })
}

async fn open_client(
    connection_string: &str,
    password: Option<Secret>,
) -> Result<Client, CoreError> {
    let mut options = ClientOptions::parse(connection_string).await?;
    options.app_name = Some("odin-db".into());
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
