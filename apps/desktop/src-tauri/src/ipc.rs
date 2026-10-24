//! Shared IPC contract pieces: error mapping and the long-operation shape (ADR-0006).

use std::future::Future;
use std::sync::Arc;

use odin_core::operations::{CancellationToken, OperationGuard, OperationId, OperationRegistry};
use odin_core::{CoreError, ErrorKind};
use serde::Serialize;
use tauri::ipc::Channel;
use tokio::sync::mpsc;

#[derive(Debug, Clone, Serialize, specta::Type)]
pub struct IpcError {
    pub kind: ErrorKind,
    pub message: String,
    /// What the UI needs to act on some errors, e.g. a host key fingerprint.
    pub detail: Option<String>,
}

impl From<CoreError> for IpcError {
    fn from(error: CoreError) -> Self {
        Self {
            kind: error.kind(),
            message: error.to_string(),
            detail: error.detail(),
        }
    }
}

/// Every long operation emits data events followed by exactly one terminal event.
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(tag = "event", content = "data", rename_all = "camelCase")]
pub enum StreamEvent<T> {
    Data(T),
    Completed,
    Cancelled,
    Failed(IpcError),
}

/// Bounded so a slow consumer applies backpressure on the producer.
const STREAM_BUFFER: usize = 4;

/// Runs a core streaming function as a registered, cancellable operation and
/// forwards its output to the frontend channel. Returns immediately with the id.
pub fn spawn_streaming_operation<T, F, Fut>(
    registry: &Arc<OperationRegistry>,
    channel: Channel<StreamEvent<T>>,
    run: F,
) -> OperationId
where
    T: Serialize + Clone + Send + 'static,
    F: FnOnce(mpsc::Sender<T>, CancellationToken) -> Fut,
    Fut: Future<Output = Result<(), CoreError>> + Send + 'static,
{
    spawn_with_guard(registry.start(), channel, run)
}

/// Like `spawn_streaming_operation`, for an open-ended feed that quitting need not ask about.
pub fn spawn_passive_streaming_operation<T, F, Fut>(
    registry: &Arc<OperationRegistry>,
    channel: Channel<StreamEvent<T>>,
    run: F,
) -> OperationId
where
    T: Serialize + Clone + Send + 'static,
    F: FnOnce(mpsc::Sender<T>, CancellationToken) -> Fut,
    Fut: Future<Output = Result<(), CoreError>> + Send + 'static,
{
    spawn_with_guard(registry.start_passive(), channel, run)
}

fn spawn_with_guard<T, F, Fut>(
    guard: OperationGuard,
    channel: Channel<StreamEvent<T>>,
    run: F,
) -> OperationId
where
    T: Serialize + Clone + Send + 'static,
    F: FnOnce(mpsc::Sender<T>, CancellationToken) -> Fut,
    Fut: Future<Output = Result<(), CoreError>> + Send + 'static,
{
    let id = guard.id();
    let (tx, mut rx) = mpsc::channel(STREAM_BUFFER);
    let producer = run(tx, guard.token());

    tauri::async_runtime::spawn(async move {
        let producer = tauri::async_runtime::spawn(producer);
        while let Some(item) = rx.recv().await {
            if channel.send(StreamEvent::Data(item)).is_err() {
                // The webview is gone (window closed or reloaded): stop the producer.
                guard.token().cancel();
                break;
            }
        }
        let terminal = match producer.await {
            Ok(Ok(())) => StreamEvent::Completed,
            Ok(Err(CoreError::Cancelled)) => StreamEvent::Cancelled,
            Ok(Err(error)) => StreamEvent::Failed(error.into()),
            Err(error) => StreamEvent::Failed(CoreError::Internal(error.to_string()).into()),
        };
        // Nothing left to notify if the channel is already closed.
        let _ = channel.send(terminal);
        drop(guard);
    });

    id
}
