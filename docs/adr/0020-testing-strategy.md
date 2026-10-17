# 0020. Testing strategy

- Status: Accepted
- Date: 2026-10-17

## Context

Correctness against real MongoDB behavior matters more than coverage numbers. Mocks of the database hide exactly the bugs we care about.

## Decision

- **Core unit tests** next to the code, for pure logic (argument builders, parsers, EJSON conversion, error mapping).
- **Core integration tests** in `crates/core/tests/` against **real MongoDB via `testcontainers`**, on a version matrix (6.0, 7.0, 8.0) in CI, including a replica-set case for transactions and change-related features. No database mocks.
- Runner: `cargo nextest`.
- **UI tests**: Vitest + Testing Library; IPC mocked with `@tauri-apps/api/mocks` (`mockIPC`), using fixtures typed from `packages/bindings`.
- **E2E smoke** with `tauri-driver` (WebDriver) on Linux and Windows in CI: launch, connect to a containerized MongoDB, run a query, edit a document. macOS has no WebDriver support for WKWebView, so macOS gets a manual release checklist.
- **Contract check**: CI regenerates bindings and fails on diff (ADR-0005).
- **Data-safety suites**: BSON round-trip (ADR-0007), import/export round-trip (ADR-0019), read-only enforcement (ADR-0017).
- A bug fix includes a test that fails without the fix.

## Alternatives considered

- **Mocking the driver** — tests would pass while real server behavior differs.
- **Playwright against the dev server only** — does not exercise the real Tauri runtime.

## Consequences

Integration tests need Docker locally (`pnpm test:integration`). `pnpm check` stays fast and Docker-free.
