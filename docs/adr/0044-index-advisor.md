# 0044. Index advisor

- Status: Accepted
- Date: 2026-10-24

## Context

Slow queries usually lack the right index. The profiler table (ADR-0042) shows single slow
operations, but users had to read plans and work out the index themselves, and the profiler is
off on most servers.

## Decision

- `advisor::advise` reads slow operations from two sources: the server's recent log (`getLog`,
  the "Slow query" entries every server writes past `slowms`, with no profiler needed) and the
  profiler of every database where it is on (first 50 databases, bounded concurrency). Each
  source reports how many operations it gave or why it could not be read.
- It keeps the operations that scanned the collection or read over 100 documents per document
  returned (at least 1000), takes their filter and sort from `find`, `aggregate` (leading
  `$match` and `$sort`), `count`, `distinct`, `update` and `delete`, and groups them by the index
  they need.
- The index follows the ESR guideline: equality fields, then the sort, then ranges; `$and` is
  looked through, `$or` is left out (its branches need indexes of their own).
- An advice names an existing, visible index that already starts with those keys: the planner
  is not choosing it, which a new index would not fix.
- The UI lists the advice in the server tab by total time spent, with the stats behind it, and
  creates the index through the usual dialog (writable connections only) or copies a
  `createIndex` command.

## Alternatives considered

- **`$queryStats`** — exact and complete, but only on recent versions and Atlas tiers.
- **Atlas Performance Advisor API** — Atlas only, and needs API keys.
- **Profiler only** — off by default, so most users would see nothing.

## Consequences

- `getLog` needs the `clusterMonitor` role and keeps only recent lines; the UI explains how to get
  more (turn on the profiler) when no source can be read.
