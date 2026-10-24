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
    /// Each operation's token, and whether quitting should wait for it.
    running: Mutex<HashMap<OperationId, (CancellationToken, bool)>>,
}

impl OperationRegistry {
    /// Registers a new operation. It stays cancellable until the returned guard is dropped.
    #[must_use]
    pub fn start(self: &Arc<Self>) -> OperationGuard {
        self.register(true)
    }

    /// An open-ended operation, such as a live feed: cancellable and cancelled on quit,
    /// but quitting does not ask about it.
    #[must_use]
    pub fn start_passive(self: &Arc<Self>) -> OperationGuard {
        self.register(false)
    }

    fn register(self: &Arc<Self>, counted: bool) -> OperationGuard {
        let id = OperationId::new();
        let token = CancellationToken::new();
        self.lock().insert(id, (token.clone(), counted));
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
            .map(|(token, _)| token.cancel())
            .is_some()
    }

    /// Cancels every running operation, e.g. before quitting.
    pub fn cancel_all(&self) {
        self.lock().values().for_each(|(token, _)| token.cancel());
    }

    /// How many operations are in flight, e.g. to confirm quitting; passive ones do not count.
    pub fn running(&self) -> usize {
        self.lock().values().filter(|(_, counted)| *counted).count()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<OperationId, (CancellationToken, bool)>> {
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
        assert_eq!(registry.running(), 1);

        assert!(registry.cancel(id));
        assert!(token.is_cancelled());

        drop(guard);
        assert!(!registry.cancel(id));
        assert_eq!(registry.running(), 0);
    }

    #[test]
    fn cancel_all_reaches_every_operation() {
        let registry = Arc::new(OperationRegistry::default());
        let (a, b) = (registry.start(), registry.start());
        registry.cancel_all();
        assert!(a.token().is_cancelled() && b.token().is_cancelled());
    }

    #[test]
    fn passive_operations_are_cancelled_but_not_counted() {
        let registry = Arc::new(OperationRegistry::default());
        let feed = registry.start_passive();
        let export = registry.start();
        assert_eq!(registry.running(), 1);
        registry.cancel_all();
        assert!(feed.token().is_cancelled() && export.token().is_cancelled());
    }
}
