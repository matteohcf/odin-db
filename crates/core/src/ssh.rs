//! SSH tunnels to MongoDB servers behind a bastion host (ADR-0036).

use std::sync::{Arc, Mutex, PoisonError};

use russh::client::{self, AuthResult, Handle};
use russh::keys::{HashAlg, PrivateKeyWithHashAlg, PublicKeyOrCertificate};
use serde::{Deserialize, Serialize};
use tokio::net::TcpListener;
use tokio::task::JoinHandle;

use crate::CoreError;
use crate::secrets::Secret;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct SshSettings {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth: SshAuth,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SshAuth {
    /// The password is kept in the OS keychain.
    Password,
    /// A private key file; its passphrase, if any, is kept in the OS keychain.
    PrivateKey { path: String },
}

impl SshSettings {
    pub(crate) fn validate(&self) -> Result<(), CoreError> {
        if self.host.trim().is_empty() || self.username.trim().is_empty() {
            return Err(CoreError::Validation(
                "an SSH tunnel needs a host and a user name".into(),
            ));
        }
        if self.port == 0 {
            return Err(CoreError::Validation(
                "the SSH port must be between 1 and 65535".into(),
            ));
        }
        if let SshAuth::PrivateKey { path } = &self.auth
            && path.trim().is_empty()
        {
            return Err(CoreError::Validation("choose a private key file".into()));
        }
        Ok(())
    }
}

/// An open tunnel: a local port forwarding to the MongoDB host through SSH.
/// Dropping it stops listening and closes the SSH session.
#[derive(Debug)]
pub struct SshTunnel {
    pub local_port: u16,
    task: JoinHandle<()>,
}

impl Drop for SshTunnel {
    fn drop(&mut self) {
        self.task.abort();
    }
}

/// Checks the server key against the pinned fingerprint, remembering what it saw.
struct PinnedHost {
    pinned: Option<String>,
    seen: Arc<Mutex<Option<String>>>,
}

impl client::Handler for PinnedHost {
    type Error = russh::Error;

    fn check_server_key(
        &mut self,
        key: &PublicKeyOrCertificate,
    ) -> impl Future<Output = Result<bool, Self::Error>> + Send {
        let fingerprint = key.public_key().fingerprint(HashAlg::Sha256).to_string();
        let trusted = self.pinned.as_deref() == Some(fingerprint.as_str());
        *self.seen.lock().unwrap_or_else(PoisonError::into_inner) = Some(fingerprint);
        // An unknown key ends the handshake before any credential is sent.
        std::future::ready(Ok(trusted))
    }
}

/// Opens an SSH session (verifying the host key against `pinned`), then
/// listens on a random local port and forwards each connection to `target`.
pub async fn open_tunnel(
    settings: &SshSettings,
    secret: Option<&Secret>,
    pinned: Option<&str>,
    target: (String, u16),
) -> Result<SshTunnel, CoreError> {
    settings.validate()?;
    let session = connect(settings, secret, pinned).await?;
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .map_err(|error| CoreError::Internal(format!("cannot open a local port: {error}")))?;
    let local_port = listener
        .local_addr()
        .map_err(|error| CoreError::Internal(error.to_string()))?
        .port();
    let session = Arc::new(session);
    let task = tokio::spawn(async move {
        while let Ok((mut socket, peer)) = listener.accept().await {
            let session = Arc::clone(&session);
            let (host, port) = target.clone();
            tokio::spawn(async move {
                let Ok(channel) = session
                    .channel_open_direct_tcpip(
                        host,
                        u32::from(port),
                        peer.ip().to_string(),
                        u32::from(peer.port()),
                    )
                    .await
                else {
                    return;
                };
                let mut stream = channel.into_stream();
                // Ends when either side closes; errors only mean the connection is gone.
                let _ = tokio::io::copy_bidirectional(&mut socket, &mut stream).await;
            });
        }
    });
    Ok(SshTunnel { local_port, task })
}

/// Reads the server's host key fingerprint without trusting it or authenticating.
pub async fn host_fingerprint(settings: &SshSettings) -> Result<String, CoreError> {
    match connect(settings, None, None).await {
        Err(CoreError::UnknownHostKey(fingerprint)) => Ok(fingerprint),
        Err(error) => Err(error),
        Ok(_) => Err(CoreError::Internal(
            "an unpinned host key was accepted".into(),
        )),
    }
}

async fn connect(
    settings: &SshSettings,
    secret: Option<&Secret>,
    pinned: Option<&str>,
) -> Result<Handle<PinnedHost>, CoreError> {
    let seen = Arc::new(Mutex::new(None));
    let handler = PinnedHost {
        pinned: pinned.map(str::to_owned),
        seen: Arc::clone(&seen),
    };
    let config = Arc::new(client::Config {
        inactivity_timeout: None,
        keepalive_interval: Some(std::time::Duration::from_secs(30)),
        ..Default::default()
    });
    let address = (settings.host.trim().to_owned(), settings.port);
    let connected = tokio::time::timeout(
        std::time::Duration::from_secs(15),
        client::connect(config, address, handler),
    )
    .await
    .map_err(|_| CoreError::Network(format!("SSH server {} did not answer", settings.host)))?;
    let mut session = match connected {
        Ok(session) => session,
        Err(error) => {
            let fingerprint = seen.lock().unwrap_or_else(PoisonError::into_inner).clone();
            return Err(match (fingerprint, pinned) {
                (Some(found), None) => CoreError::UnknownHostKey(found),
                (Some(found), Some(expected)) if found != expected => {
                    CoreError::HostKeyChanged(found)
                }
                _ => CoreError::Network(format!(
                    "SSH connection to {} failed: {error}",
                    settings.host
                )),
            });
        }
    };
    let user = settings.username.trim().to_owned();
    let result = match &settings.auth {
        SshAuth::Password => {
            let password =
                secret.ok_or_else(|| CoreError::Auth("enter the SSH password".into()))?;
            session.authenticate_password(user, password.expose()).await
        }
        SshAuth::PrivateKey { path } => {
            let key = russh::keys::load_secret_key(path, secret.map(Secret::expose)).map_err(
                |error| CoreError::Auth(format!("cannot read the private key {path}: {error}")),
            )?;
            let hash = session
                .best_supported_rsa_hash()
                .await
                .map_err(|error| CoreError::Network(error.to_string()))?
                .flatten();
            session
                .authenticate_publickey(user, PrivateKeyWithHashAlg::new(Arc::new(key), hash))
                .await
        }
    }
    .map_err(|error| CoreError::Network(format!("SSH authentication failed: {error}")))?;
    match result {
        AuthResult::Success => Ok(session),
        AuthResult::Failure { .. } => Err(CoreError::Auth(format!(
            "the SSH server refused the credentials for {}",
            settings.username.trim()
        ))),
    }
}

/// The connection string pointed at the tunnel's local port: one direct
/// connection, since replica set members are not reachable through one forward.
/// With TLS the certificate is still verified, but not its host name, which
/// cannot match `127.0.0.1`.
pub fn tunneled_uri(uri: &str, local_port: u16) -> Result<String, CoreError> {
    let uri = uri.trim();
    if uri.starts_with("mongodb+srv://") {
        return Err(CoreError::Validation(
            "SRV connection strings cannot go through an SSH tunnel: use mongodb:// with one member's host and port".into(),
        ));
    }
    let rest = uri.strip_prefix("mongodb://").ok_or_else(|| {
        CoreError::Validation("the connection string must start with mongodb://".into())
    })?;
    let authority_end = rest.find(['/', '?']).unwrap_or(rest.len());
    let (authority, tail) = rest.split_at(authority_end);
    let userinfo = authority
        .rfind('@')
        .map(|at| &authority[..=at])
        .unwrap_or_default();
    let (path, query) = match tail.split_once('?') {
        Some((path, query)) => (path, query),
        None => (tail, ""),
    };
    let mut params: Vec<&str> = query
        .split('&')
        .filter(|param| !param.is_empty())
        .filter(|param| {
            let key = param
                .split('=')
                .next()
                .unwrap_or_default()
                .to_ascii_lowercase();
            !matches!(
                key.as_str(),
                "directconnection" | "replicaset" | "loadbalanced"
            )
        })
        .collect();
    let tls = params
        .iter()
        .any(|param| matches!(param.to_ascii_lowercase().as_str(), "tls=true" | "ssl=true"));
    params.push("directConnection=true");
    if tls
        && !params.iter().any(|p| {
            p.to_ascii_lowercase()
                .starts_with("tlsallowinvalidhostnames=")
        })
    {
        params.push("tlsAllowInvalidHostnames=true");
    }
    let path = if path.is_empty() { "/" } else { path };
    Ok(format!(
        "mongodb://{userinfo}127.0.0.1:{local_port}{path}?{}",
        params.join("&")
    ))
}

/// Host and port to forward to: the first host of the connection string.
pub fn tunnel_target(uri: &str) -> Result<(String, u16), CoreError> {
    let parsed = mongodb::options::ConnectionString::parse(uri.trim())
        .map_err(|error| CoreError::Validation(format!("invalid connection string: {error}")))?;
    let mongodb::options::HostInfo::HostIdentifiers(hosts) = parsed.host_info else {
        return Err(CoreError::Validation(
            "SRV connection strings cannot go through an SSH tunnel".into(),
        ));
    };
    let host = hosts
        .into_iter()
        .next()
        .ok_or_else(|| CoreError::Validation("the connection string has no host".into()))?;
    match host {
        mongodb::options::ServerAddress::Tcp { host, port } => Ok((host, port.unwrap_or(27017))),
        other => Err(CoreError::Validation(format!(
            "{other} cannot be reached through an SSH tunnel"
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rewrites_connection_strings_to_the_local_port() {
        assert_eq!(
            tunneled_uri("mongodb://db.internal:27018", 4242).expect("plain"),
            "mongodb://127.0.0.1:4242/?directConnection=true"
        );
        assert_eq!(
            tunneled_uri(
                "mongodb://ada@a.internal,b.internal/shop?replicaSet=rs0&authSource=admin&tls=true",
                4242
            )
            .expect("replica set"),
            "mongodb://ada@127.0.0.1:4242/shop?authSource=admin&tls=true&directConnection=true&tlsAllowInvalidHostnames=true"
        );
        assert!(matches!(
            tunneled_uri("mongodb+srv://cluster0.example.net", 1),
            Err(CoreError::Validation(_))
        ));
    }

    #[test]
    fn forwards_to_the_first_host() {
        assert_eq!(
            tunnel_target("mongodb://ada@a.internal:27018,b.internal/x").expect("target"),
            ("a.internal".to_owned(), 27018)
        );
        assert_eq!(
            tunnel_target("mongodb://db").expect("default port"),
            ("db".to_owned(), 27017)
        );
    }

    fn settings(auth: SshAuth) -> SshSettings {
        SshSettings {
            host: "bastion.example.com".into(),
            port: 22,
            username: "ada".into(),
            auth,
        }
    }

    #[test]
    fn settings_need_a_host_a_user_and_a_key_path() {
        assert!(settings(SshAuth::Password).validate().is_ok());
        assert!(matches!(
            SshSettings {
                host: " ".into(),
                ..settings(SshAuth::Password)
            }
            .validate(),
            Err(CoreError::Validation(_))
        ));
        assert!(matches!(
            settings(SshAuth::PrivateKey {
                path: String::new()
            })
            .validate(),
            Err(CoreError::Validation(_))
        ));
    }
}
