# 0022. CI, releases, updates, code signing

- Status: Accepted
- Date: 2026-10-17

## Context

Three platforms, public releases, automatic updates. Code signing will come shortly via a company Apple Developer account; the first releases ship unsigned.

## Decision

**CI (GitHub Actions)**, on every PR:
- `check` job (Linux): Biome, typecheck, knip, Vitest, rustfmt, clippy, cargo-deny, unit tests, bindings diff.
- `integration` job: core tests against MongoDB 6.0/7.0/8.0 via testcontainers.
- `build` matrix: Windows, macOS (arm64 + x64), Linux, to catch platform breakage early.
- `e2e` smoke: Linux and Windows.
- Actions pinned to commit SHAs; Rust and pnpm caches.

**Releases**: **release-please** turns Conventional Commits into version bumps, changelog and a release PR. Merging it tags the release; `tauri-action` builds and uploads artifacts: `.msi`/NSIS (Windows), `.dmg` (macOS universal or per-arch), `.AppImage`, `.deb`, `.rpm` (Linux). One version for the whole product, kept in sync across Cargo and npm manifests.

**Updates**: `tauri-plugin-updater` with a `latest.json` published on GitHub Releases. Update artifacts are signed with the Tauri updater key (stored as a GitHub secret); this is independent of OS code signing and is active from the first release. The update check can be disabled.

**Code signing**: initially **unsigned**; the README documents the Gatekeeper and SmartScreen steps. Planned next: macOS signing and notarization with the company Apple Developer account (the developer name shown will be the company's), and Windows signing via Azure Trusted Signing or SignPath Foundation. Sidecars are signed together with the app.

## Alternatives considered

- **semantic-release** — fully automated publishing without a reviewable release PR.
- **Manual changelogs** — drift and get forgotten.

## Consequences

Commit messages directly drive releases, so commitlint is a hard gate.
