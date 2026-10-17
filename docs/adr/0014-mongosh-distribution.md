# 0014. mongosh distribution: detect or download

- Status: Accepted
- Date: 2026-10-17

## Context

mongosh is a packaged Node binary of roughly 100 MB per platform. Bundling it would multiply installer size for a secondary feature.

## Decision

Resolution order when the user opens a shell:
1. Path configured in settings.
2. `mongosh` found on `PATH`.
3. Previously downloaded copy in the app data directory.
4. Offer a **one-click download** of the supported version from MongoDB's official downloads.

Download integrity: the supported mongosh version and the **expected SHA-256 for each platform are pinned in our source code** (the trust anchor is our signed release, not the download origin). The archive is verified before extraction; on mismatch it is deleted and an error is shown. Version bumps are PRs (Renovate-assisted). Download is disableable for offline or locked-down environments.

## Alternatives considered

- **Bundled sidecar** — installer grows from ~20 MB to over 120 MB, and every mongosh release forces an odin-db release.
- **Detection only** — users without mongosh face a manual install. Acceptable fallback if the downloader slips from V1.

## Consequences

A small, security-sensitive downloader in core (HTTPS only, hash-verified, extraction guarded against path traversal), with tests for tampered archives.
