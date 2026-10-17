# 0033. Database Tools built from source

- Status: Accepted (supersedes the sourcing part of ADR-0015)
- Date: 2026-10-17

## Context

ADR-0015 bundles mongodump and mongorestore as sidecars, downloaded at build time with pinned hashes, and flagged a risk: MongoDB's Linux builds are per distribution and link system libraries, so no single official binary runs on every distribution an AppImage targets.

## Decision

- The release workflow **builds both tools from MongoDB's source** (`mongodb/mongo-tools`) for each target with `CGO_ENABLED=0`, using `scripts/build-database-tools.sh`. The source is fetched **by commit hash** (the commit of the pinned release tag, currently 100.19.1), so the build input is fixed; the Go version is pinned in the workflow.
- Pure Go builds are static and distribution-independent. They support SCRAM, X.509, AWS and OIDC authentication and TLS; only Kerberos (GSSAPI) needs cgo, and it is outside the V1 scope (ADR-0018).
- Sidecars are declared in `tauri.release.conf.json`, merged only by release builds (`tauri build --config`), so development builds and CI checks do not need them. At runtime they are found next to the executable (ADR-0029).
- Version bumps change the two pinned values in the script, in a PR.

## Alternatives considered

- **Official binaries with pinned hashes** (ADR-0015's plan) — fine on macOS and Windows, but Linux would need one binary per distribution.
- **Official binaries on macOS/Windows, source build on Linux** — two supply paths to maintain for no functional gain in V1.
- **Requiring users to install the tools** — the current fallback (`PATH`), not a good first experience.

## Consequences

- Release jobs need a Go toolchain; building both tools adds about a minute per target.
- Adding Kerberos later means cgo builds per platform, or official binaries where available.
