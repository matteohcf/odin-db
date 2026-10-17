# odin-db

Open source desktop client for MongoDB. A free alternative to Studio 3T, built with Tauri 2 (Rust) and React.

> **Status: early development.** Connections, database browsing, queries and document editing work. Indexes, aggregation, import/export, backup and the shell are next. Not ready for production data yet.

## Planned for v1

Document CRUD, query editor, index management, aggregation builder, backup/restore (mongodump/mongorestore), JSON/CSV import and export, integrated mongosh shell. Windows, macOS and Linux.

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
