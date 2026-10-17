# 0029. Database Tools resolution and process safety

- Status: Accepted (complements ADR-0015)
- Date: 2026-10-17

## Context

ADR-0015 bundles mongodump/mongorestore as sidecars. Official Linux builds are distribution-specific, so portable bundling needs its own work (a static build from source in CI). Backup and restore should not wait for the release pipeline, and running external processes adds failure modes of its own.

## Decision

- **Resolution order**: the directory of the running executable (where Tauri places sidecars), then the user's `PATH`. When neither has both tools, the dialogs explain how to install them; `database_tools_status` reports availability and version. Bundling (pinned versions and SHA-256 from MongoDB's release feed) lands with the release milestone, including the Linux portability work.
- **Credentials**: the sanitized URI goes on the command line; the password goes in a `--config` YAML file created with mode `0600` (Unix) in the per-user temp directory, removed when the process ends, whatever the outcome.
- **Output handling**: stderr is drained continuously and parsed into events (`done dumping`, `finished restoring`, `Failed:`). Events are sent with `try_send`: a slow consumer must never stop the drain, or the tool blocks on a full pipe. Totals are computed in core, so they stay exact.
- **Safety**: restores are refused on read-only profiles in core. A restore with `--drop` requires typing the target name (ADR-0017). A failed or cancelled backup deletes the partial archive. Cancelling kills the child process.
- CI installs the pinned, hash-verified Linux tools and runs a real backup and restore round trip.

## Consequences

Until bundling ships, users need the tools installed. The deadlock this ADR prevents was found by an integration test, which stays as the guard.
