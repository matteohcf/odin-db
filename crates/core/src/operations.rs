use std::collections::HashMap;
use std::sync::{Arc, Mutex, PoisonError};

use serde::{Deserialize, Serialize};
pub use tokio_util::sync::CancellationToken;
use uuid::Uuid;

/// Identifies a long-running, cancellable operation (ADR-0006).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(transparent)]
pub struct OperationId(Uuid);

impl OperationId {
    fn new() -> Self {
        Self(Uuid::now_v7())
    }
}

/// Tracks running operations so they can be cancelled by id.
#[derive(Debug, Default)]
pub struct OperationRegistry {
    running: Mutex<HashMap<OperationId, CancellationToken>>,
}

impl OperationRegistry {
    /// Registers a new operation. It stays cancellable until the returned guard is dropped.
    #[must_use]
    pub fn start(self: &Arc<Self>) -> OperationGuard {
        let id = OperationId::new();
        let token = CancellationToken::new();
        self.lock().insert(id, token.clone());
        OperationGuard {
            id,
            token,
            registry: Arc::clone(self),
        }
    }

    /// Returns `false` if the operation already finished or never existed.
    pub fn cancel(&self, id: OperationId) -> bool {
        self.lock()
            .get(&id)
            .map(CancellationToken::cancel)
            .is_some()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<OperationId, CancellationToken>> {
        // The map holds no invariants a panicking thread could break, so poisoning is ignored.
        self.running.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

#[derive(Debug)]
pub struct OperationGuard {
    id: OperationId,
    token: CancellationToken,
    registry: Arc<OperationRegistry>,
}

impl OperationGuard {
    #[must_use]
    pub fn id(&self) -> OperationId {
        self.id
    }

    #[must_use]
    pub fn token(&self) -> CancellationToken {
        self.token.clone()
    }
}

impl Drop for OperationGuard {
    fn drop(&mut self) {
        self.registry.lock().remove(&self.id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancel_triggers_token_and_guard_drop_unregisters() {
        let registry = Arc::new(OperationRegistry::default());
        let guard = registry.start();
        let id = guard.id();
        let token = guard.token();

        assert!(registry.cancel(id));
        assert!(token.is_cancelled());

        drop(guard);
        assert!(!registry.cancel(id));
    }
}
