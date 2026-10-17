# 0005. Rust as source of truth, generated TS bindings

- Status: Accepted
- Date: 2026-10-17

## Context

Every type crossing IPC exists twice (Rust and TS). Hand-maintained duplicates drift and break at runtime instead of at compile time.

## Decision

Rust types are the single source of truth. **tauri-specta** generates `packages/bindings` (TS types, typed command wrappers, typed events, typed `Channel<T>` payloads).

- There is no stable 2.x release (checked 2026-10-17: latest `2.0.0-rc.25`; `1.0.2` targets Tauri 1 only). We pin exact versions: `tauri-specta = "=2.0.0-rc.25"` and the matching `specta`. Upgrades are deliberate PRs.
- Generation runs through a dedicated binary in `src-tauri` (`pnpm bindings`), not as a side effect of app startup, so output is deterministic and CI-friendly.
- CI regenerates the bindings and fails on `git diff --exit-code packages/bindings`.
- The UI never calls `invoke()` with string command names.

## Alternatives considered

- **Hand-written TS types** — drift, no compile-time safety.
- **ts-rs** — types only, no typed command wrappers or events.
- **TauRPC** — viable, also built on specta, but a smaller community and its own RPC abstraction over Tauri commands.

## Consequences

Release-candidate dependency risk is contained: bindings are generated, so swapping the generator only touches `src-tauri` annotations and regenerated output.
