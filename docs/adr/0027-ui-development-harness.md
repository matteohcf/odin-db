# 0027. UI development harness

- Status: Accepted
- Date: 2026-10-17

## Context

The desktop webview cannot be driven by browser automation on macOS, and developing the UI against a real server slows iteration and makes edge cases (read-only profiles, unreachable servers, empty views, large collections) hard to reproduce on demand.

## Decision

- `pnpm --filter @odin-db/desktop dev:web` outside Tauri installs an **in-memory mock backend** (`src/dev/mock-backend.ts`) through `@tauri-apps/api/mocks`. It is loaded only when `import.meta.env.DEV && !isTauri()`, so it never ships.
- The mock honors the real command contract: generated types, typed `IpcError` kinds, cursor paging, read-only profiles, write errors. Query support is deliberately shallow (equality filters, inclusion projections); query semantics are tested against real MongoDB in core integration tests (ADR-0020).
- UI flows are reviewed in a regular browser (manually or with Playwright) against the mock, in light and dark themes.

## Consequences

The mock must be updated whenever a command is added or changes shape; TypeScript catches most drift because it imports the generated binding types.
