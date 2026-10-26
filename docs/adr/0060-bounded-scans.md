# 0060. Bounded scans

- Status: Proposed
- Date: 2026-10-26

## Context

Schema, schema compare and the database diagram sample documents with `$sample`. That stage is
cheap only as the first stage of a plain collection asking for under 5% of its documents: the
server then picks them with a random cursor. Anywhere else it reads every input document and sorts
them at random:

- after a `$match` (a filtered schema), it reads every matching document;
- on a view, the stage is appended to the view's pipeline, so it always scans;
- on a time series it samples buckets only when they are at least about a quarter full; otherwise it
  unpacks every bucket.

Schema compare on an 11 GB database holding time series collections took a cluster's CPU to 100%,
four collections at a time. Cancelling did not help: dropping a request here does not stop an
aggregation that is still computing its first batch on the server.

## Decision

- Every feature that reads many documents to show one result (schema, schema compare, diagram,
  value search, distinct values) is bounded on the server, in `crates/core/src/sampling.rs`.
- Samples go through `sampling::sample_documents`, which builds the pipeline from the collection's
  kind (`sampling::sample_pipeline`):
  - a plain collection without a filter: `$sample` alone, at random;
  - a time series, a view, or any filter: `[$match,] $limit: MAX_SCANNED, $sample`, so at most
    `MAX_SCANNED` (10,000) documents are read and the sample comes from the first of them.
- Every scan carries `maxTimeMS` (`SCAN_TIME_LIMIT`, 30 s), which the server enforces even after
  the operation is cancelled here. Estimated counts carry `COUNT_TIME_LIMIT` (5 s).
- Value search reports a collection that runs out of time as partially searched and goes on with
  the next one.
- A new feature that scans documents uses these helpers and limits, or explains in its ADR why it
  reads everything (collection compare, exports and copies do, by design, with progress and Stop).

## Alternatives considered

- **`maxTimeMS` only** — the server still burns the CPU for the whole limit on every collection,
  and an unbounded `$sample` on a time series nearly always reaches it.
- **Random samples of time series through `$natural` order or skips** — no documented way to make
  them cheap on every supported version.
- **A setting for the limits** — a value nobody tunes until the cluster is already in trouble; the
  query bar keeps its own time limit (ADR-0052).

## Consequences

- The schema of a time series, a view or a filter describes the first 10,000 matching documents,
  not a random sample of all of them: old measurements weigh more on a time series.
- A filter matching few documents in a large collection without an index can still time out; the
  error says so instead of loading the server indefinitely.
- Collection kind is looked up once per sample (`listCollections` filtered by name) when the caller
  does not already know it.
