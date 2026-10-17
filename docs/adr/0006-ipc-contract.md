# 0006. IPC contract: commands, channels, events

- Status: Accepted
- Date: 2026-10-17

## Context

Tauri 2 offers three primitives: commands (single request/response), events (global broadcast), and channels (`tauri::ipc::Channel<T>`, an ordered stream bound to one invocation). Long operations (large queries, backup, import, shell output) must stream, be isolated per tab, and be cancellable. Errors must be typed.

## Decision

- **Request/response → command.**
- **Long operation → command with a `Channel<T>` argument + an `OperationId`.** The command returns once the operation is registered; data and progress flow through the channel. Payloads are batched (e.g. 500 documents per message), never one message per document.
- **Cancellation**: core keeps a `CancellationToken` (tokio-util) per `OperationId`; `cancel_operation(id)` triggers it. Dropping a channel does not stop work, so cancellation is always explicit, and closing a tab cancels its operations.
- **Events only for app-wide notifications** (connection state changes, update available). All typed via tauri-specta.
- **Core stays transport-agnostic**: streaming core APIs take `mpsc::Sender<T>` + `CancellationToken`; `src-tauri` bridges to `Channel<T>`.
- **Errors**: core defines `CoreError` (`thiserror`). `src-tauri` maps it to a serializable `IpcError { kind, message, details? }` with `kind` as a closed, tagged enum (e.g. `Auth`, `Network`, `Timeout`, `NotFound`, `ReadOnly`, `Cancelled`, `Validation`, `Internal`). The UI switches exhaustively on `kind`. Messages never contain secrets.
- **No protocol versioning**: UI and backend ship in the same binary and are always the same version.

## Alternatives considered

- **Events for streaming** — global broadcast, manual filtering per operation, weak typing and ordering.
- **Local WebSocket/HTTP server** (as in t3code) — t3code needs it because its server is a separate Node process with independently versioned clients. For us it adds an open port and local auth for no benefit.

## Consequences

Every long operation follows the same shape (start → stream → complete | error | cancelled), so UI progress and cancellation can be generic.
