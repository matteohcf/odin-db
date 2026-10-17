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

## Not yet in place

- **Code signing**: builds are unsigned until the company Apple Developer account and a Windows signing service are set up (ADR-0022).
- **Automatic updates**: `tauri-plugin-updater` needs an update-signing key pair. The private key belongs in a repository secret, so generating it is a maintainer step.
