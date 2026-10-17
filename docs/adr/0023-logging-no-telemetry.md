# 0023. Logging, diagnostics, no telemetry

- Status: Accepted
- Date: 2026-10-17

## Context

Users of a database client care about what leaves their machine. We still need actionable bug reports.

## Decision

- **Logging**: `tracing` in Rust, routed through `tauri-plugin-log` so frontend logs and Rust logs share one pipeline; rotating files in the OS log directory; level configurable in settings. Secrets and connection strings are redacted (ADR-0017). Document contents are never logged.
- **Diagnostics**: a "Copy diagnostics" action collects app version, OS, webview version, server versions of connected deployments (no hostnames unless the user opts in) and the tail of the log; the GitHub issue template asks for it.
- **No telemetry, no crash reporting service.** The only network calls the app makes on its own are the update check (ADR-0022) and the on-demand mongosh download (ADR-0014). Both can be disabled. This is documented in the README.

## Alternatives considered

- **Opt-in crash reporting (e.g. Sentry)** — useful, but a trust cost for little gain at this stage. Can be proposed in a future ADR as strictly opt-in.

## Consequences

Bug reports depend on users sharing diagnostics, so the diagnostics bundle must be easy to produce and safe to share.
