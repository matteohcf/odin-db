# 0025. Pull-based result paging

- Status: Accepted (supersedes the transport described in ADR-0009)
- Date: 2026-10-17

## Context

ADR-0009 keeps query cursors in core and pages on demand, but described the first batch as streamed over a `Channel`. Milestone 0 showed that a Tauri `Channel` has no consumer acknowledgement: a producer faster than the webview piles data up in webview memory (docs/milestone-0.md, finding 1).

## Decision

Result paging uses plain **request/response commands**, never a channel:

- `find_documents(connection, namespace, request) -> DocumentPage` runs the query and returns the first batch.
- `fetch_more_documents(cursor_id, batch_size) -> DocumentPage` returns the next batch.
- `close_cursor(cursor_id)` releases a cursor early.
- `DocumentPage { documents, cursor_id }`: `cursor_id` is `null` once the cursor is exhausted; core then releases it itself. Small results never leave a cursor open.

The UI asks for the next page only when the grid nears the end of loaded rows, so the consumer controls the pace. On the UI side, `createResultsController` owns the cursor lifecycle: every run gets a generation number, late answers from a superseded run are dropped and their cursors closed, the row cap (20,000 by default) releases the cursor, and closing the tab disposes it.

## Alternatives considered

- **Channel streaming with acknowledgements** — reinvents request/response with more moving parts.
- **Channel streaming without flow control** — unbounded webview memory.

## Consequences

Channels stay for genuinely push-shaped work (progress, logs, shell output) and must then implement flow control (ADR-0006, docs/milestone-0.md). Results logic is unit-tested without React (`results-controller.test.ts`).
