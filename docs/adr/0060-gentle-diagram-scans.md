# 0060. Gentle, saved diagram scans

- Status: Accepted (supersedes the sampling and lookup parts of ADR-0043)
- Date: 2026-10-27

## Context

The database diagram (ADR-0043) drives the server's CPU to 100% on large databases. Three
things make it heavy:

- `$sample` on a view cannot use WiredTiger's random cursor: the server runs the whole view
  pipeline over its source and sorts it. Time series and very large collections can also be slow.
- No query has a time limit, and cancelling only drops the future: a command already sent keeps
  running on the server.
- Reference lookups are one `count_documents` per candidate and target: up to 200 × 40 queries,
  sequential, each an aggregation.

The diagram is an exploration aid. It must never be the reason a production database slows
down. Every scan also starts from scratch, even when nothing changed since the last one.

## Decision

### Guards that always apply (core)

- Every query the scan sends has `maxTimeMS` (5 s). A sample that hits it leaves the collection
  with `error` set to the server's message, and the collection without fields. It remains a
  reference target, because an `_id` lookup is cheap anywhere. A lookup that hits the limit skips
  that target. The rest of the diagram still stands.
- The scan reads with `secondaryPreferred`, so a replica set's primary is left alone.
- **Views are neither sampled nor counted.** They appear as nodes marked "not sampled", never as
  reference targets (already the case).
- **Lookups are grouped by target**: per target collection, one
  `find({ _id: { $in: ids } }, { projection: { _id: 1 } })` (covered by the `_id` index, ids in
  chunks of 1000) gets every id of every candidate that tries that target. Matches are counted
  per candidate in memory. The query count drops from candidates × targets to about the number of
  targets. The rules for choosing an edge are unchanged (named targets first, blind search only
  in small databases, at least half of the sampled values must match).

### Pace (core and UI)

`database_diagram` takes a `ScanPace`: `fast`, `balanced` or `gentle`. Core maps it to:

| Pace     | Collections in parallel | Pause between queries | Sample size | Blind search |
|----------|-------------------------|-----------------------|-------------|--------------|
| fast     | 4                       | 0                     | 100         | yes          |
| balanced | 2                       | 100 ms                | 100         | yes          |
| gentle   | 1                       | 500 ms                | 50          | no           |

There are three presets and no free-form knobs, because users cannot judge thread counts and
pauses for an unknown server.

### Starting a scan (UI)

"New scan" opens a dialog. It shows the database's collection count and size, read from the
sidebar's cached queries (`sizeOnDisk`). They are fetched once only if the sidebar never loaded
them, and those are metadata reads. The dialog also shows the three paces with one marked as recommended by `recommendPace` (`diagram/lib`):

- `fast` up to 50 collections and under 1 GB;
- `gentle` from 300 collections or 50 GB;
- `balanced` in between.

For `gentle` it says the scan may take a while and the tab stays usable meanwhile. Progress,
Stop and quitting work as before (a registered operation).

### Saved scans (core storage and UI)

- A completed scan is saved in SQLite (`diagram_scans`: id, profile, database, time, pace,
  diagram as JSON), cascading when the profile is deleted. Saving happens in Rust at the end of
  the operation. A cancelled or failed scan is not saved.
- Only what the diagram already holds is saved: names, field paths and types, estimated counts,
  references and their match counts. No document values.
- After each save, scans beyond the newest `keep` for that profile and database are deleted.
  `keep` comes from the `diagramScansKept` setting (default 10, range 1–50), passed with the
  command.
- Opening a diagram tab lists the saved scans and shows the newest one without querying the
  server. A select in the header switches to older ones ("27 Oct, 14:32 · Gentle · 412
  collections"). With no saved scan, the tab opens the "New scan" dialog.
- A scan with collections skipped (timeout, permissions) is saved and opened like any other. The
  header shows "N collections skipped" and the nodes show why.
- Settings has the `diagramScansKept` row and a "Delete all saved diagrams" action
  (`clear_diagram_scans`).
- Node positions and annotations stay per database (ADR-0047), shared by every scan.

### Commands

- `database_diagram(connectionId, database, pace, keep, channel)`: finishes with the saved scan's
  summary and the diagram.
- `list_diagram_scans(profileId, database)`: summaries, newest first (id, time, pace, collection,
  link and skipped counts).
- `get_diagram_scan(id)`: the diagram.
- `clear_diagram_scans()`: the number deleted.

### Details

- **Where it lives.** Saving uses core (`diagram::scans`, like `backup::history`) and is called by
  the `src-tauri` command. The profile comes from `ConnectionHandle::info.profile_id`. Core
  clamps `keep` to 1–50.
- **The end event** is `Finished { diagram, scan: Option<DiagramScanSummary>, saveError }`. If
  saving fails, the diagram is still shown, `scan` is `None` and the UI says "not saved", with
  the error as its tooltip. `src-tauri` has no logger. A long scan is never lost to a storage
  error. Saving and pruning run in one transaction.
- **Stored format.** The JSON is `DatabaseDiagram` itself, with no version column. Fields added
  later take `#[serde(default)]`. A scan that cannot be read back is an error in
  `get_diagram_scan`, and the tab shows it and offers a new scan.
- **Summary counts.** `collections` counts every node, views included. `skipped` counts the
  collections with `error` set (views have none). `links` counts the edges.
- **Pause and parallelism.** The pause is per task, after each query it sends. Sampling runs `n`
  tasks in parallel. Lookups run one target at a time.
- **Time limits.** `$sample`, `estimated_document_count` and the lookups get `maxTimeMS`. A count
  that fails stays 0, as today. `list_collections` is unchanged, since it reads metadata only.
- **Read preference.** `secondaryPreferred` is set on the collection handles the scan uses
  (`clone_with_options`), not on a separate client.
- **Lookups.** `MAX_CANDIDATES`, `MAX_IDS`, `MAX_BLIND_TARGETS` and `MIN_MATCH` are unchanged.
  Per target: the union of the ids of every candidate trying it, de-duplicated, sent in chunks of
  1000. Each candidate's `matched` is how many of its own ids came back. If any chunk fails or
  times out, that target is skipped for every candidate.
- **UI data.** The dialog gets the collection count and database size from `connections`. Its
  index gains the exports it needs (the collections query and the database list) and nothing
  more.
- **Tab behaviour.** A scan that completes becomes the selected one. A scan that fails while a
  diagram is shown keeps the diagram and shows "New scan failed". Deleting all scans from
  settings invalidates the scan queries: an open tab shows an empty state with "New scan" and
  does not open the dialog by itself. The dialog opens automatically only when a tab opens with
  no saved scan (once connected). A restored tab shows the newest saved scan and never scans by itself.

## Alternatives considered

- **Only the guards, no pace** — removes the worst cases, but a database with thousands of
  collections is still read as fast as the client can go.
- **Free-form settings (concurrency, pause, sample size)** — more control than anyone can use
  safely. The presets cover it.
- **Saving scans in local storage** — diagrams of large databases are big, and the webview's
  storage is easily lost. SQLite already holds the backup history.
- **Showing a cached scan and refreshing it in the background** — that would query the server
  without the user asking for it, which is exactly what this ADR avoids.

## Consequences

- Reopening a diagram costs the server nothing. A new scan always goes through an explicit
  choice of pace.
- A gentle scan of a large database can take many minutes. The tab shows progress and can be
  stopped.
- Collections that are too expensive to sample appear without fields instead of slowing the
  server.
- A new SQLite table and migration. The diagram types derive `Deserialize` to be read back.
