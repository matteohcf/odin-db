# 0039. Automatic updates

- Status: Accepted
- Date: 2026-10-18

## Context

Users install odin-db from GitHub releases. Without updates in the app, most installs stay on
the version first downloaded, security fixes included.

## Decision

- `tauri-plugin-updater` checks `releases/latest/download/latest.json` on GitHub. Release builds
  create the update archives (`createUpdaterArtifacts` in `tauri.release.conf.json`) and sign
  them with a minisign key; the public key is in `tauri.conf.json`, the private key only in
  repository secrets and an offline copy.
- Checking is a command, `check_for_update`; installing is a long operation, `install_update`,
  registered and cancellable like any other, with lossy progress events. The app restarts when
  it completes.
- The app checks once at launch, behind the `checkForUpdates` setting (on by default), and only
  offers the update in a toast. Nothing downloads or installs without a click. Settings → About
  shows the state and can check again.
- The update feature (`features/updates`) is used by `settings` for its row; `src/app` wires the
  launch check.

## Alternatives considered

- **Silent background installs** — rejected: replacing a database tool mid-session, or without
  consent, is surprising.
- **Our own update server** — unnecessary while GitHub releases are public and free.

## Consequences

- Updates only work while the repository (or a mirror of `latest.json` and the archives) is
  public.
- Losing the private key strands every install; rotating it takes one release signed with the
  old key.
- The updater pulls in `zip` 4.x, whose advisories affect only Windows extraction of archives we
  sign ourselves; they are ignored in `deny.toml` with that reasoning.
