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
}

/// The platform keyring: Keychain, Windows Credential Manager or Secret Service.
#[derive(Debug, Default)]
pub struct KeyringStore;

impl KeyringStore {
    fn entry(profile: ProfileId) -> Result<keyring::Entry, CoreError> {
        keyring::Entry::new(SERVICE, &format!("profile:{profile}:password"))
            .map_err(|error| CoreError::SecretStore(error.to_string()))
    }
}

impl SecretStore for KeyringStore {
    fn set_password(&self, profile: ProfileId, password: &Secret) -> Result<(), CoreError> {
        Self::entry(profile)?
            .set_password(password.expose())
            .map_err(|error| CoreError::SecretStore(error.to_string()))
    }

    fn password(&self, profile: ProfileId) -> Result<Option<Secret>, CoreError> {
        match Self::entry(profile)?.get_password() {
            Ok(password) => Ok(Some(Secret::new(password))),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(CoreError::SecretStore(error.to_string())),
        }
    }

    fn delete_password(&self, profile: ProfileId) -> Result<(), CoreError> {
        match Self::entry(profile)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(CoreError::SecretStore(error.to_string())),
        }
    }
}

/// In-memory store for tests and for sessions where no keyring is available.
#[derive(Debug, Default)]
pub struct MemoryStore {
    passwords: Mutex<HashMap<ProfileId, Secret>>,
}

impl MemoryStore {
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
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn debug_output_never_contains_the_secret() {
        let secret = Secret::new("hunter2");
        assert_eq!(format!("{secret:?}"), "Secret(***)");
        assert!(!format!("{:?}", Some(&secret)).contains("hunter2"));
    }
}
