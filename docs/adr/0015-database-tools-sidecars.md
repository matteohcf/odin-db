# 0015. mongodump/mongorestore as sidecars

- Status: Accepted, sourcing superseded by ADR-0033
- Date: 2026-10-17

## Context

Backup/restore must be faithful to MongoDB's own format. MongoDB Database Tools (Apache-2.0) are the reference implementation and are small enough to bundle.

## Decision

- `mongodump` and `mongorestore` are bundled as Tauri sidecars (`externalBin`, per target triple), fetched at build time by a script with **pinned versions and pinned SHA-256 hashes**. Not committed to git.
- `src-tauri` resolves the sidecar path and passes it to `crates/core::backup`, which builds arguments, spawns via `tokio::process`, parses progress, and streams it over the operation's channel. Cancellation kills the process tree.
- The frontend can never spawn processes: no shell plugin permissions are exposed to the webview (ADR-0017).
- **Credentials**: never on the command line. Core writes a temporary YAML `--config` file containing the password, with `0600` permissions (owner-only ACL on Windows), and deletes it when the process exits, including on error and cancellation.
- Output format choices: archive (`--archive`, `--gzip`) or directory.

## Open implementation risk

Official Linux builds of Database Tools are distribution-specific (dynamic linking). Milestone 0 must confirm a portable option: the most portable official build, or building from source in CI as a statically linked binary.

## Alternatives considered

- **Reimplementing dump/restore in Rust** — large effort, format fidelity risk.
- **Requiring a user install** — friction for a core V1 feature.

## Consequences

Release pipeline downloads and verifies tools per platform. When code signing is enabled (ADR-0022), sidecars are signed and notarized with the app.
