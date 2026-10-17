# 0034. Backup history and schedules

- Status: Accepted (builds on ADR-0015 and ADR-0029)
- Date: 2026-10-17

## Context

Backups are what users of a MongoDB client rely on most, and a backup nobody can find, or one that only happens when someone remembers, does not protect anything. Studio 3T offers scheduled tasks; Compass offers nothing. odin-db already runs mongodump safely (ADR-0029) but kept no record of what it produced.

## Decision

- **History.** Every backup, started by hand or by a schedule, is a row in the local SQLite store (`backup_runs`): connection, scope, archive path, start and end, status, size, collection and document counts, error. A run is recorded *before* anything can fail, so failures (missing tools, credentials, unwritable folder, server down) are always visible. Runs left `running` by a crash are marked failed at the next launch. History rows follow their profile on deletion.
- **Schedules.** `backup_schedules` holds a connection, a scope, a destination folder, a timing (hourly at a minute, daily at a time, weekly on a day at a time) and how many backups to keep. Times are wall-clock times in the user's time zone, computed with `jiff`, so a 02:00 backup stays at 02:00 across daylight saving changes.
- **Scheduler.** The Tauri host checks for due schedules every 30 seconds while the app runs. A schedule that missed runs while the app was closed is due once, not once per missed slot. Scheduled backups read credentials from the profile and keychain, so they need no open connection. Each schedule runs at most once at a time.
- **Retention.** After a scheduled backup succeeds, only its newest `keep` completed backups are kept; older archives are deleted from disk with their rows. Manual backups are never pruned.
- **Names.** Scheduled archives are named `<connection>_<scope>_<date>_<time>.archive.gz` in local time, sanitized for every file system.
- **Paths stay in the backend** (ADR-0017): folders come from a Rust dialog as tokens, history actions (restore, show in folder, delete) take run ids, and the webview only displays paths.
- **UI.** A Backups tab (sidebar, connection menu, command palette) shows schedules and the history, with restore into the original or another writable connection. A `BackupsChanged` event refreshes it as runs start and finish.

## Alternatives considered

- **OS schedulers** (launchd, Task Scheduler, cron) — run when the app is closed, but need per-OS installers, elevated permissions in places, and a headless binary with keychain access; revisit with a background agent.
- **A fixed interval anchored at creation** — simpler, but drifts from the times people pick and breaks across daylight saving changes.
- **History in `localStorage`** — would lose the record when the webview data is cleared, and the scheduler runs in Rust.

## Consequences

- Schedules only run while odin-db is open; the UI says so, and missed runs catch up at launch.
- The store gains two tables (migration 2); history is capped at the newest 500 runs in the UI.
