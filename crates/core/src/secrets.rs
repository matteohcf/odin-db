//! Credentials live only in the OS keyring (ADR-0016). Secrets never appear in logs.

use std::collections::HashMap;
use std::fmt;
use std::sync::{Mutex, PoisonError};

use serde::Deserialize;

use crate::CoreError;
use crate::profiles::ProfileId;

const SERVICE: &str = "io.github.matteohcf.odin-db";

/// A secret value whose `Debug` output is redacted, so it cannot leak through logs.
/// Deliberately not `Serialize`: secrets flow from the UI to the backend, never back.
#[derive(Clone, PartialEq, Eq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(transparent)]
pub struct Secret(String);

impl Secret {
    #[must_use]
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    #[must_use]
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Secret(***)")
    }
}

pub trait SecretStore: Send + Sync {
    fn set_password(&self, profile: ProfileId, password: &Secret) -> Result<(), CoreError>;
    fn password(&self, profile: ProfileId) -> Result<Option<Secret>, CoreError>;
    /// Succeeds when there is nothing to delete.
    fn delete_password(&self, profile: ProfileId) -> Result<(), CoreError>;
    /// The SSH tunnel's password or private key passphrase (ADR-0036).
    fn set_ssh_secret(&self, profile: ProfileId, secret: &Secret) -> Result<(), CoreError>;
    fn ssh_secret(&self, profile: ProfileId) -> Result<Option<Secret>, CoreError>;
    /// Succeeds when there is nothing to delete.
    fn delete_ssh_secret(&self, profile: ProfileId) -> Result<(), CoreError>;
}

/// The platform keyring: Keychain, Windows Credential Manager or Secret Service.
/// The OS keychain (macOS Keychain, Windows Credential Manager, Secret Service).
///
/// Every secret lives in one keychain item, read once and then kept in memory: macOS asks the
/// user for each item an app reads, so one item per password meant one prompt per connection,
/// again on every read. Items from older versions (one per profile) move in when first read.
pub type KeyringStore = VaultStore<KeychainItems>;

/// Keychain items by account name, under odin-db's service.
pub trait ItemStore: Send + Sync {
    fn read(&self, account: &str) -> Result<Option<String>, CoreError>;
    fn write(&self, account: &str, value: &str) -> Result<(), CoreError>;
    fn delete(&self, account: &str) -> Result<(), CoreError>;
}

#[derive(Debug, Default)]
pub struct KeychainItems;

impl KeychainItems {
    fn entry(account: &str) -> Result<keyring::Entry, CoreError> {
        keyring::Entry::new(SERVICE, account)
            .map_err(|error| CoreError::SecretStore(error.to_string()))
    }
}

impl ItemStore for KeychainItems {
    fn read(&self, account: &str) -> Result<Option<String>, CoreError> {
        match Self::entry(account)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(CoreError::SecretStore(error.to_string())),
        }
    }

    fn write(&self, account: &str, value: &str) -> Result<(), CoreError> {
        Self::entry(account)?
            .set_password(value)
            .map_err(|error| CoreError::SecretStore(error.to_string()))
    }

    fn delete(&self, account: &str) -> Result<(), CoreError> {
        match Self::entry(account)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(CoreError::SecretStore(error.to_string())),
        }
    }
}

const VAULT: &str = "vault";

/// All secrets as one JSON object in a single item, cached after the first read.
#[derive(Debug, Default)]
pub struct VaultStore<S> {
    items: S,
    cache: Mutex<Option<HashMap<String, String>>>,
}

impl<S: ItemStore> VaultStore<S> {
    #[must_use]
    pub fn new(items: S) -> Self {
        Self {
            items,
            cache: Mutex::new(None),
        }
    }

    fn with_vault<T>(
        &self,
        change: impl FnOnce(&mut HashMap<String, String>) -> Result<(T, bool), CoreError>,
    ) -> Result<T, CoreError> {
        let mut cache = self.cache.lock().unwrap_or_else(PoisonError::into_inner);
        if cache.is_none() {
            let stored = self.items.read(VAULT)?;
            let vault = match stored {
                Some(json) => serde_json::from_str(&json).map_err(|error| {
                    CoreError::SecretStore(format!("unreadable vault: {error}"))
                })?,
                None => HashMap::new(),
            };
            *cache = Some(vault);
        }
        let vault = cache.get_or_insert_with(HashMap::new);
        let (result, changed) = change(vault)?;
        if changed {
            let json = serde_json::to_string(vault)
                .map_err(|error| CoreError::SecretStore(error.to_string()))?;
            self.items.write(VAULT, &json)?;
        }
        Ok(result)
    }

    fn get(&self, account: &str) -> Result<Option<Secret>, CoreError> {
        self.with_vault(|vault| {
            if let Some(value) = vault.get(account) {
                return Ok((Some(Secret::new(value.clone())), false));
            }
            // A secret saved by an older version, in its own item: move it into the vault.
            match self.items.read(account)? {
                Some(value) => {
                    vault.insert(account.to_owned(), value.clone());
                    Ok((Some(Secret::new(value)), true))
                }
                None => Ok((None, false)),
            }
        })
        .and_then(|found| {
            if found.is_some() {
                self.items.delete(account)?;
            }
            Ok(found)
        })
    }

    fn set(&self, account: &str, secret: &Secret) -> Result<(), CoreError> {
        self.with_vault(|vault| {
            vault.insert(account.to_owned(), secret.expose().to_owned());
            Ok(((), true))
        })
    }

    fn remove(&self, account: &str) -> Result<(), CoreError> {
        self.with_vault(|vault| Ok(((), vault.remove(account).is_some())))?;
        self.items.delete(account)
    }
}

fn account(profile: ProfileId, name: &str) -> String {
    format!("profile:{profile}:{name}")
}

impl<S: ItemStore> SecretStore for VaultStore<S> {
    fn set_password(&self, profile: ProfileId, password: &Secret) -> Result<(), CoreError> {
        self.set(&account(profile, "password"), password)
    }

    fn password(&self, profile: ProfileId) -> Result<Option<Secret>, CoreError> {
        self.get(&account(profile, "password"))
    }

    fn delete_password(&self, profile: ProfileId) -> Result<(), CoreError> {
        self.remove(&account(profile, "password"))
    }

    fn set_ssh_secret(&self, profile: ProfileId, secret: &Secret) -> Result<(), CoreError> {
        self.set(&account(profile, "ssh"), secret)
    }

    fn ssh_secret(&self, profile: ProfileId) -> Result<Option<Secret>, CoreError> {
        self.get(&account(profile, "ssh"))
    }

    fn delete_ssh_secret(&self, profile: ProfileId) -> Result<(), CoreError> {
        self.remove(&account(profile, "ssh"))
    }
}

#[derive(Debug, Default)]
pub struct MemoryStore {
    passwords: Mutex<HashMap<ProfileId, Secret>>,
    ssh: Mutex<HashMap<ProfileId, Secret>>,
}

impl MemoryStore {
    fn ssh_lock(&self) -> std::sync::MutexGuard<'_, HashMap<ProfileId, Secret>> {
        self.ssh.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<ProfileId, Secret>> {
        self.passwords
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }
}

impl SecretStore for MemoryStore {
    fn set_password(&self, profile: ProfileId, password: &Secret) -> Result<(), CoreError> {
        self.lock().insert(profile, password.clone());
        Ok(())
    }

    fn password(&self, profile: ProfileId) -> Result<Option<Secret>, CoreError> {
        Ok(self.lock().get(&profile).cloned())
    }

    fn delete_password(&self, profile: ProfileId) -> Result<(), CoreError> {
        self.lock().remove(&profile);
        Ok(())
    }

    fn set_ssh_secret(&self, profile: ProfileId, secret: &Secret) -> Result<(), CoreError> {
        self.ssh_lock().insert(profile, secret.clone());
        Ok(())
    }

    fn ssh_secret(&self, profile: ProfileId) -> Result<Option<Secret>, CoreError> {
        Ok(self.ssh_lock().get(&profile).cloned())
    }

    fn delete_ssh_secret(&self, profile: ProfileId) -> Result<(), CoreError> {
        self.ssh_lock().remove(&profile);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Items in memory, counting reads the way macOS counts keychain prompts.
    #[derive(Default)]
    struct CountingItems {
        items: Mutex<HashMap<String, String>>,
        reads: Mutex<usize>,
    }

    impl ItemStore for &CountingItems {
        fn read(&self, account: &str) -> Result<Option<String>, CoreError> {
            *self.reads.lock().expect("lock") += 1;
            Ok(self.items.lock().expect("lock").get(account).cloned())
        }
        fn write(&self, account: &str, value: &str) -> Result<(), CoreError> {
            self.items
                .lock()
                .expect("lock")
                .insert(account.into(), value.into());
            Ok(())
        }
        fn delete(&self, account: &str) -> Result<(), CoreError> {
            self.items.lock().expect("lock").remove(account);
            Ok(())
        }
    }

    #[test]
    fn reads_the_keychain_once_however_many_secrets() {
        let items = CountingItems::default();
        let store = VaultStore::new(&items);
        let profiles: Vec<ProfileId> = (0..20).map(|_| ProfileId::new()).collect();
        for profile in &profiles {
            store
                .set_password(*profile, &Secret::new("pw"))
                .expect("set");
        }
        let fresh = VaultStore::new(&items);
        *items.reads.lock().expect("lock") = 0;
        for profile in &profiles {
            assert_eq!(
                fresh.password(*profile).expect("read").map(|s| s.0),
                Some("pw".into())
            );
            assert_eq!(
                fresh.password(*profile).expect("again").map(|s| s.0),
                Some("pw".into())
            );
        }
        assert_eq!(*items.reads.lock().expect("lock"), 1);
    }

    #[test]
    fn moves_secrets_of_older_versions_into_the_vault() {
        let items = CountingItems::default();
        let profile = ProfileId::new();
        (&items)
            .write(&format!("profile:{profile}:password"), "old")
            .expect("legacy");
        let store = VaultStore::new(&items);
        assert_eq!(
            store.password(profile).expect("read").map(|s| s.0),
            Some("old".into())
        );
        let stored = items.items.lock().expect("lock").clone();
        assert!(!stored.contains_key(&format!("profile:{profile}:password")));
        assert!(stored.get("vault").is_some_and(|json| json.contains("old")));
        store.delete_password(profile).expect("delete");
        assert!(store.password(profile).expect("gone").is_none());
    }

    #[test]
    fn debug_output_never_contains_the_secret() {
        let secret = Secret::new("hunter2");
        assert_eq!(format!("{secret:?}"), "Secret(***)");
        assert!(!format!("{:?}", Some(&secret)).contains("hunter2"));
    }
}
