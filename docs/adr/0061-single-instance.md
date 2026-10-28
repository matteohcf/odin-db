# 0061. One running instance

- Status: Accepted (builds on ADR-0034)
- Date: 2026-10-28

## Context

Opening odin-db a second time started a second process. Each process spawns the backup scheduler (ADR-0034), so a due schedule could run twice, and both processes write the same local SQLite store and read the same window state. Nothing in the app is designed for two writers.

## Decision

- **One process per desktop session.** `tauri-plugin-single-instance` is registered as the first plugin: plugins initialize in order when the app is built, before the main window and the setup that opens the store and spawns the scheduler. A second launch hands its arguments to the running process and exits.
- **The running window comes forward.** The running process unminimizes, shows and focuses the `main` window (`src-tauri/src/single_instance.rs`). The second launch's arguments and working directory are ignored: odin-db opens no files or links from the command line.
- **The lock is the bundle identifier** (`io.github.matteohcf.odin-db`), without the plugin's `semver` feature: a named mutex in the logon session on Windows, a machine-wide socket in `/tmp` on macOS (a second user's launch cannot use it and launches normally), a session D-Bus name on Linux. The locked 2.5.4 (recheck the name when the lock moves) owns `io.github.matteohcf.odin-db.SingleInstance` (the identifier plus `.SingleInstance`, not the `org.…` form the plugin guide shows); Snap and Flatpak packages must declare that name if they are ever added.

## Alternatives considered

- **A lock file or a lock row in SQLite** — would stop the second scheduler, but the second window would still open and fail later; focusing the first window needs inter-process signalling, which the plugin already does per OS.
- **Let instances coexist and lock schedules** — every shared resource (store, window state, operations, quit handling) would need coordination for a case users do not need.

## Consequences

- Scheduled backups run once, and the store has one writer.
- Two copies cannot run side by side in one session, even with different data; a dev build and an installed build have the same identifier, so the second of the two to start exits.
- Where the plugin cannot reach its mechanism (no session D-Bus on Linux, an unusable socket on macOS), it launches normally: two processes are then possible again.
- The plugin has no JavaScript API: no capability changes.
