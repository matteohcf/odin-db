//! Connections exported by MongoDB Compass ("Export saved connections"). The file is canonical
//! Extended JSON; secrets are either inline, removed, or encrypted with a passphrase in
//! `connectionSecrets` (AES-256-GCM, PBKDF2-SHA512 key, see Compass's `encrypt.ts`).

use aes_gcm::aead::consts::U16;
use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::aes::Aes256;
use aes_gcm::{AesGcm, Nonce};
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use serde_json::Value;
use sha2::Sha512;

use super::{ImportEntry, ProfileColor, SharedConnection};
use crate::CoreError;
use crate::secrets::Secret;
use crate::ssh::{SshAuth, SshSettings};

const FILE_TYPE: &str = "Compass Connections";

pub(super) fn is_compass(value: &Value) -> bool {
    value.get("type").and_then(Value::as_str) == Some(FILE_TYPE)
}

pub(super) fn needs_passphrase(value: &Value) -> bool {
    connections(value).is_ok_and(|list| {
        list.iter()
            .any(|connection| connection.get("connectionSecrets").is_some())
    })
}

pub(super) fn parse(value: Value, passphrase: Option<&str>) -> Result<Vec<ImportEntry>, CoreError> {
    // Canonical EJSON wraps every number ({"$numberInt": "22"}); relaxed gives plain JSON.
    let value = bson::Bson::try_from(value)
        .map_err(|error| invalid(&error.to_string()))?
        .into_relaxed_extjson();
    connections(&value)?
        .iter()
        .map(|connection| entry(connection, passphrase))
        .collect()
}

fn connections(value: &Value) -> Result<&Vec<Value>, CoreError> {
    value
        .get("connections")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid("no connections"))
}

fn entry(connection: &Value, passphrase: Option<&str>) -> Result<ImportEntry, CoreError> {
    let options = connection
        .get("connectionOptions")
        .ok_or_else(|| invalid("a connection has no options"))?;
    let connection_string = options
        .get("connectionString")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("a connection has no connection string"))?;
    let secrets = match connection.get("connectionSecrets").and_then(Value::as_str) {
        Some(encrypted) => {
            let passphrase = passphrase.ok_or_else(|| {
                CoreError::Validation("this file is protected with a password".into())
            })?;
            decrypt(encrypted, passphrase)?
        }
        None => Value::Null,
    };
    let secret = |path: &str| {
        secrets
            .pointer(path)
            .and_then(Value::as_str)
            .map(Secret::new)
    };

    let tunnel = options.get("sshTunnel").filter(|tunnel| tunnel.is_object());
    let text = |key: &str| {
        tunnel
            .and_then(|tunnel| tunnel.get(key))
            .and_then(Value::as_str)
            .filter(|text| !text.is_empty())
    };
    let (ssh, ssh_secret) = match (text("host"), text("username")) {
        (Some(host), Some(username)) => {
            let port = tunnel
                .and_then(|tunnel| tunnel.get("port"))
                .and_then(Value::as_u64)
                .and_then(|port| u16::try_from(port).ok())
                .unwrap_or(22);
            let (auth, inline) = match text("identityKeyFile") {
                Some(path) => (
                    SshAuth::PrivateKey { path: path.into() },
                    text("identityKeyPassphrase"),
                ),
                None => (SshAuth::Password, text("password")),
            };
            let from_file = match auth {
                SshAuth::PrivateKey { .. } => secret("/secrets/sshTunnelPassphrase"),
                SshAuth::Password => secret("/secrets/sshTunnelPassword"),
            };
            let settings = SshSettings {
                host: host.into(),
                port,
                username: username.into(),
                auth,
            };
            (Some(settings), inline.map(Secret::new).or(from_file))
        }
        _ => (None, None),
    };

    let favorite = connection.get("favorite");
    let name = favorite
        .and_then(|favorite| favorite.get("name"))
        .and_then(Value::as_str)
        .filter(|name| !name.trim().is_empty())
        .map_or_else(|| host_of(connection_string), str::to_owned);
    let color = favorite
        .and_then(|favorite| favorite.get("color"))
        .and_then(Value::as_str)
        .and_then(color);

    Ok(ImportEntry {
        shared: SharedConnection {
            name,
            connection_string: connection_string.to_owned(),
            read_only: false,
            color,
            ssh,
            group: None,
        },
        password: secret("/secrets/password"),
        ssh_secret,
    })
}

fn decrypt(encrypted: &str, passphrase: &str) -> Result<Value, CoreError> {
    let wrong = || CoreError::Validation("wrong password, or the file is damaged".into());
    let data = STANDARD.decode(encrypted).map_err(|_| wrong())?;
    // version (2) || salt (16) || iv (16) || auth tag (16) || ciphertext
    if data.len() < 50 || data[..2] != [0, 1] {
        return Err(invalid("encrypted with an unknown scheme"));
    }
    let (salt, iv, tag, ciphertext) = (&data[2..18], &data[18..34], &data[34..50], &data[50..]);
    let mut key = [0_u8; 32];
    pbkdf2::pbkdf2_hmac::<Sha512>(passphrase.as_bytes(), salt, 100_000, &mut key);
    let cipher = AesGcm::<Aes256, U16>::new_from_slice(&key).map_err(|_| wrong())?;
    let sealed = [ciphertext, tag].concat();
    let nonce = Nonce::<U16>::try_from(iv).map_err(|_| wrong())?;
    let plain = cipher
        .decrypt(&nonce, sealed.as_slice())
        .map_err(|_| wrong())?;
    let ejson: Value = serde_json::from_slice(&plain).map_err(|_| wrong())?;
    Ok(bson::Bson::try_from(ejson)
        .map_err(|_| wrong())?
        .into_relaxed_extjson())
}

/// Compass's palette: color1 to color9 (color10 is "no color").
fn color(code: &str) -> Option<ProfileColor> {
    Some(match code {
        "color1" => ProfileColor::Green,
        "color2" => ProfileColor::Teal,
        "color3" => ProfileColor::Blue,
        "color4" | "color5" => ProfileColor::Purple,
        "color6" => ProfileColor::Red,
        "color7" => ProfileColor::Pink,
        "color8" => ProfileColor::Orange,
        "color9" => ProfileColor::Yellow,
        _ => return None,
    })
}

/// A name for an unnamed connection, without its credentials.
pub(super) fn host_of(connection_string: &str) -> String {
    let rest = connection_string
        .split_once("://")
        .map_or(connection_string, |(_, rest)| rest);
    let authority = rest.split(['/', '?']).next().unwrap_or(rest);
    authority
        .rsplit_once('@')
        .map_or(authority, |(_, hosts)| hosts)
        .to_owned()
}

fn invalid(reason: &str) -> CoreError {
    CoreError::Validation(format!("not a Compass connections file: {reason}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    // Produced by Compass's serializeConnections with passphrase "s3cret" (Node's crypto).
    const ENCRYPTED: &str = include_str!("compass_encrypted.json");

    #[test]
    fn decrypts_secrets_with_the_passphrase() {
        let value: Value = serde_json::from_str(ENCRYPTED).expect("json");
        assert!(needs_passphrase(&value));
        let entries = parse(value.clone(), Some("s3cret")).expect("parsed");
        let entry = &entries[0];
        assert_eq!(entry.password.as_ref().map(Secret::expose), Some("p@ss"));
        assert_eq!(
            entry.ssh_secret.as_ref().map(Secret::expose),
            Some("tunnel-pw")
        );
        let ssh = entry.shared.ssh.as_ref().expect("ssh");
        assert_eq!((ssh.host.as_str(), ssh.port), ("bastion.example.com", 2222));
        assert_eq!(entry.shared.color, Some(ProfileColor::Red));

        assert!(matches!(
            parse(value.clone(), Some("nope")),
            Err(CoreError::Validation(message)) if message.starts_with("wrong password")
        ));
        assert!(parse(value, None).is_err());
    }

    #[test]
    fn names_unnamed_connections_without_credentials() {
        assert_eq!(host_of("mongodb://u:pw@a:1,b:2/db?x=1"), "a:1,b:2");
        assert_eq!(host_of("mongodb+srv://c.example.net"), "c.example.net");
    }
}
