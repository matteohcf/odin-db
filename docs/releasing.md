# Releasing

Releases are driven by Conventional Commits (ADR-0022) and built by `.github/workflows/release.yml`.

## One-time setup

1. **Settings → Actions → General → Workflow permissions**: enable *Allow GitHub Actions to create and approve pull requests*. release-please needs it to open the release PR.
2. **Settings → Secrets and variables → Actions → Variables**: add `RELEASE_PLEASE` = `true`. Until then the release job is skipped, so pushes to `main` stay green.

## Cutting a release

1. Every push to `main` updates a **release PR** with the next version (from `feat:` / `fix:` / breaking changes) and the changelog.
2. Merging that PR tags `vX.Y.Z` and creates the GitHub release.
3. The build matrix then uploads the installers to it: macOS `.dmg` (Apple silicon and Intel), Windows `.msi` and NSIS `.exe`, Linux `.AppImage`, `.deb` and `.rpm`. mongodump and mongorestore are built from source and bundled (ADR-0033).

## Checking packaging without releasing

Run the **Release** workflow manually (*Actions → Release → Run workflow*). It builds every installer and attaches them to the run as artifacts.

## Automatic updates

Builds are signed for `tauri-plugin-updater` (ADR-0039): the release job creates the update
archives and their signatures, and tauri-action uploads `latest.json` to the release. The app
checks `releases/latest/download/latest.json`, so updates reach users only while the repository
is public (or the endpoint in `tauri.conf.json` points to a public mirror).

- Private key: repository secrets `TAURI_SIGNING_PRIVATE_KEY` and
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`; the maintainer keeps a copy offline.
- Public key: `plugins.updater.pubkey` in `apps/desktop/src-tauri/tauri.conf.json`.
- Losing the private key means existing installs can never update again; rotating it needs one
  release signed with the old key that ships the new public key.

## Not yet in place

- **Code signing**: builds are unsigned until the company Apple Developer account and a Windows signing service are set up (ADR-0022).
