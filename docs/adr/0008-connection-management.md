# 0008. Connection management

- Status: Accepted
- Date: 2026-10-17

## Context

`mongodb::Client` is a thread-safe, cheaply clonable connection pool designed to be long-lived and shared. We must distinguish a **profile** (persisted configuration) from a **session** (a live client), and decide where live state is owned.

## Decision

- **One `Client` per connected profile**, shared by all tabs on that connection.
- `ConnectionManager` in `crates/core` owns live clients: `RwLock<HashMap<ConnectionId, ConnectionHandle>>`. `src-tauri` registers it as managed state. The UI only knows `ConnectionId`.
- Opening a connection is a pipeline: resolve profile → load secrets from keyring → build `ClientOptions` → (transport step, reserved for the SSH tunnel, ADR-0018) → connect → `ping`.
- Connection health comes from the driver's SDAM/heartbeat monitoring events and is pushed to the UI as a typed app-wide event (`connected | degraded | lost | reconnected`).
- `ConnectionHandle` also carries the profile flags that core enforces (e.g. read-only, ADR-0017).
- Profiles and secrets are persisted per ADR-0016.

## Alternatives considered

- **One client per tab** — multiplies connections, authentications and TLS handshakes; against the driver's design.
- **State in the frontend** — the frontend must not be the authority on connection state.

## Consequences

All tabs share the pool (driver default `maxPoolSize` 100, ample for a desktop client). Disconnecting a profile cancels its running operations and closes its cursors.
