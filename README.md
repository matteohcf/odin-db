# odin-db

Open source desktop client for MongoDB. A free alternative to Studio 3T, built with Tauri 2 (Rust) and React.

> **Status: pre-release.** The v1 feature set works; it has not been through real-world use yet. Not ready for production data.

## Features

- **Connections**: connection string or form (SRV, TLS, auth, replica sets), passwords in the OS keychain, read-only profiles enforced in the backend, live status when a server stops answering.
- **Queries**: filter, sort and projection editors that suggest the collection's fields, operators, BSON constructors and the values of enum-like fields; saved and recent queries; Explain with index suggestions.
- **Results**: a fast virtualized table (resize, hide and sort columns, edit or filter by a single value) or a list of expandable document trees; documents edited in mongosh syntax that keeps every BSON type.
- **Aggregation builder**: stages with live previews and suggestions based on the previous stage's output; saved pipelines.
- **Collections**: schema analysis, storage stats, indexes, and creating, renaming and dropping databases and collections.
- **Settings**: language (English, Italian), theme, zoom, editor and shell fonts, result paging, query history.
- **Data movement**: JSON and CSV import (insert, replace or merge by `_id`) and export of collections and whole databases; copy of collections and databases between connections, with options, views and indexes; backup and restore with the bundled mongodump and mongorestore, selective restores, scheduled backups with retention and history.
- **Shell**: the real mongosh in a tab, downloaded and verified on request.
- **Everywhere**: command palette (⌘K / Ctrl+K), keyboard shortcuts (⌘/ / Ctrl+/), light and dark themes, Windows, macOS and Linux.

## Installing

Installers for macOS (Apple silicon and Intel), Windows and Linux (AppImage, deb, rpm) are attached to each [release](https://github.com/matteohcf/odin-db/releases). mongodump and mongorestore are included. The shell uses your installed [mongosh](https://www.mongodb.com/try/download/shell), or downloads and verifies it in one click.

Early builds are not code-signed yet:

- **macOS**: the first time, right-click the app and choose **Open**, or run `xattr -dr com.apple.quarantine /Applications/odin-db.app`.
- **Windows**: SmartScreen may warn about an unknown publisher; choose **More info → Run anyway**.

## Principles

- Data correctness first: BSON types never change silently ([ADR-0007](docs/adr/0007-bson-representation.md)).
- Credentials live in the OS keyring, never in files or logs ([ADR-0017](docs/adr/0017-security-model.md)).
- No telemetry ([ADR-0023](docs/adr/0023-logging-no-telemetry.md)).
- Every architectural decision is recorded in [`docs/adr`](docs/adr/README.md).

## Development

Prerequisites: Node.js 22+, pnpm 10, Rust via [rustup](https://rustup.rs) (the toolchain is pinned in `rust-toolchain.toml`) and the [Tauri system dependencies](https://tauri.app/start/prerequisites/) for your OS.

```sh
pnpm install
pnpm dev        # run the desktop app
pnpm check      # all lint, type and test gates (same as CI)
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow and [CLAUDE.md](CLAUDE.md) for architecture rules.

## License

Licensed under either of [Apache License 2.0](LICENSE-APACHE) or [MIT license](LICENSE-MIT), at your option. MongoDB is a trademark of MongoDB, Inc.; odin-db is not affiliated with MongoDB, Inc.
