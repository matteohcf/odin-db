# 0052. Collation, hint and time limit for queries

- Status: Accepted
- Date: 2026-10-25

## Context

Compass and Studio 3T let a query set a collation (case-insensitive matching, locale-aware
sorting), an index hint and `maxTimeMS`. Without them a user cannot match `"PRO"` and `"pro"`
together, force an index the planner skips, or stop a runaway query on a production cluster
short of closing the tab.

## Decision

- `QueryOptions { collation, hint, maxTimeMs }` in `core::query` is one optional field,
  `options`, on `FindRequest`, `AggregateRequest` and `ExplainRequest`, and a parameter of
  `count_documents`. A hint is an index name or its keys. `maxTimeMs` 0 means no limit.
- The query bar's options row gets Collation, Hint and Max time (ms). The fields are optional in
  `QueryForm`, so queries remembered or saved before them still load; they go into history like
  the rest of the form.
- A setting, `queryTimeLimitSeconds` (default 60, 0 for none), is the time limit for every find,
  count, explain and pipeline that does not set its own (`withTimeLimit` in `lib/settings.ts`).
  Exports keep only what the query set: a long export should not stop at the interactive limit.

## Alternatives considered

- **A client-side timeout** — the server would keep working after the UI gave up; `maxTimeMS`
  stops the work where it happens.
- **No default limit** — the safe default matters most on the shared clusters the app is used
  against; 60 seconds is above what an interactive query should take.

## Consequences

- A query that times out shows the server's "operation exceeded time limit" error; raising the
  limit is one field or one setting away.
- Generated code (query code dialog) does not include these options yet.
