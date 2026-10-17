# 0017. Security model

- Status: Accepted
- Date: 2026-10-17

## Context

odin-db holds credentials to production databases and can destroy data. The webview renders untrusted content (document values). Security has to be structural.

## Decision

**Trust boundary: the webview is untrusted; Rust is the enforcement point.**

- **Tauri capabilities**: minimal per window; no generic filesystem, shell or HTTP permissions exposed to the frontend. File access goes through dedicated commands with OS dialogs.
- **Strict CSP**: no remote scripts, no `unsafe-eval`. Document values are always rendered as text, never as HTML.
- **No process spawning from the frontend**: sidecars and mongosh are spawned only by core.
- **Secrets**: keyring only (ADR-0016); write-only from the UI; never in logs, errors, IPC responses or command-line arguments; wrapped in a redacting type in Rust. Connection strings are redacted before logging.
- **Read-only profiles**: a profile flag enforced in core before any write operation (insert, update, delete, index changes, drop, restore, import). The UI also hides write actions, but core is authoritative. In the mongosh terminal, read-only cannot be enforced by us; the UI warns and recommends a read-only database user.
- **Destructive operations** (drop database or collection, delete many without a filter, restore with `--drop`) require typing the target name to confirm.
- **Input validation**: all IPC inputs are validated in Rust (ids, names, pipelines, paths).
- **Downloads**: HTTPS only, pinned hashes (ADR-0014, ADR-0015).
- **Supply chain**: `cargo-deny` (advisories, licenses, sources), lockfiles committed, Renovate updates, GitHub Actions pinned to commit SHAs.
- Vulnerability disclosure via `SECURITY.md` and GitHub private advisories.

## Consequences

Every new command is reviewed against this list. The security ADR is the checklist for PRs touching IPC.
