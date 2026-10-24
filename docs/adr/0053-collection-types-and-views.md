# 0053. Collection types and views

- Status: Accepted
- Date: 2026-10-25

## Context

Creating a collection only took a name. Compass and Studio 3T also create capped, time series
and clustered collections, set a default collation, and save an aggregation pipeline as a view.
Views in particular are how teams share a filtered or reshaped collection without copying data.

## Decision

- `catalog::create_collection` takes `CollectionOptions { kind, collation }`. `NewCollectionKind`
  is `standard`, `capped { sizeBytes, maxDocuments }`, `timeSeries { timeField, metaField,
  granularity, expireAfterSeconds }`, `clustered { expireAfterSeconds }` or
  `view { source, pipeline }`. Core builds one raw `create` command from it and validates what
  each kind needs before the round trip.
- The create collection dialog keeps the name first; type, its settings and collation sit behind
  "More options" (`CollectionTypeFields`, parsed by `toCollectionOptions`).
- The aggregation toolbar's Create view saves the pipeline as written, without disabled stages,
  beside its source. `aggregation` only reports the pipeline (`onCreateView`); the collection tab
  opens `connections`' `CreateViewDialog`, which creates the view and opens it.

## Alternatives considered

- **A separate `create_view` command** — a view is created by the same `create` command; one
  entry point keeps the read-only check and name validation in one place.
- **Driver option builders per kind** — the raw command is shorter and covers every server
  version the app supports the same way.

## Consequences

- Sizes cross IPC as numbers (`f64` bytes, `u32` counts and seconds), as specta forbids 64-bit
  integers; a capped collection's maximum document count is capped at 2³² − 1.
