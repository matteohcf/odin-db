# 0042. Query profiler

- Status: Accepted
- Date: 2026-10-18

## Context

The server tab showed operations running now, but slow queries are usually short and gone
before anyone looks. MongoDB's database profiler records them in `system.profile`, with the
plan and how many documents each one read.

## Decision

- `profiler::status` and `profiler::set_status` read and change a database's profiling level
  (off, slow operations, all) and its slow threshold through the `profile` command. Changing
  it is a server setting, so read-only profiles cannot (enforced in Rust).
- `profiler::entries` reads the most recent 500 entries of `system.profile`, newest first, with
  the plan summary, documents and keys examined, documents returned and the command.
- The server tab gets a "Slow queries" section with its own database selector. It refreshes
  with the tab while the profiler records, flags a `COLLSCAN` that read documents or more than
  100 documents read per document returned as probably missing an index, and opens an entry in
  full.

## Alternatives considered

- **Reading the server log (`getLog`)** — it holds slow operations for every database, but as
  free text, and only the last few thousand lines across all components.
- **A dedicated tab** — the profiler is about the same server's health as the monitor, and most
  users look for it there.

## Consequences

- Profiling at "all operations" costs throughput on a busy server; the level list says so by
  naming what each records, and the default stays off.
- Managed tiers that disallow the `profile` command (some Atlas tiers) show the server's error
  in place of the list.
