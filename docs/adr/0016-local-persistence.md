# 0016. Local persistence: SQLite and OS keyring

- Status: Accepted
- Date: 2026-10-17

## Context

The app persists connection profiles, settings, query history (grows unbounded, must be searchable) and saved queries. Secrets must never be stored in plain files.

## Decision

- **SQLite** via `rusqlite` (bundled) in the app data directory, owned by `crates/core::storage`. Schema changes through versioned, forward-only migrations (`rusqlite_migration`), run at startup inside a transaction.
- Stored: profiles (no secrets), settings, query history (with retention limit), saved queries and pipelines.
- **Secrets** (passwords, certificate passphrases, OIDC/AWS secrets) live only in the OS keyring via `keyring`, service `io.github.matteohcf.odin-db`, keyed by `ProfileId` + secret kind. Deleting a profile deletes its secrets.
- Secrets are write-only from the UI's point of view: the UI can set or clear them, never read them back.
- Import/export of profiles excludes secrets unless the user explicitly opts in with an encrypted export (later).

## Alternatives considered

- **JSON files** — full rewrites on every change, no querying, fragile concurrent writes; fine for settings, poor for history.
- **tauri-plugin-store / tauri-plugin-sql** — would put persistence in the Tauri layer or the frontend; persistence belongs to core.
- **Encrypted local vault with master password** — duplicates what the OS keyring already does well.

## Consequences

Linux requires a Secret Service provider (GNOME Keyring, KWallet). If none is available, the user is told clearly and can still connect by entering secrets per session (not stored).
