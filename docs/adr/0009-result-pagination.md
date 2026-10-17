# 0009. Result pagination via server-side cursors

- Status: Accepted; transport superseded by ADR-0025
- Date: 2026-10-17

## Context

Queries can match millions of documents. The grid must start fast and scroll smoothly. `skip/limit` pagination is O(n) on the server for deep pages and inconsistent while data changes.

## Decision

- A query opens a **cursor held in core**, registered under the tab's `OperationId`.
- The first batch is streamed immediately via the operation's channel. Further batches are fetched **on demand** when the virtualized grid nears the end of loaded rows (`fetch_more(operation_id)`). Default batch size 500, configurable.
- The UI keeps loaded rows in the tab's result store up to a configurable cap. Beyond the cap the user is told to refine the query or export.
- Cursors are closed when the tab closes, the query is re-run, the connection drops, or after an idle timeout.
- If the server reports `CursorNotFound` (server idle timeout, 10 min default), the UI shows "results expired, re-run" and never re-runs implicitly.
- Counts are explicit: estimated count by default, exact `countDocuments` on request (can be expensive).
- No hidden `skip/limit` emulation. Explicit user `skip`/`limit` in the query is honored as written.

## Alternatives considered

- **skip/limit pages** — slow deep pages, duplicates or gaps under concurrent writes.
- **Load everything** — unbounded memory.
- **`noCursorTimeout`** — leaks server resources; discouraged by MongoDB.

## Consequences

Core holds per-tab cursor state with a lifecycle that must be tested (close on every exit path).
