# 0031. Query bar assistance

- Status: Accepted
- Date: 2026-10-17

## Context

The query bar (filter, sort, projection) is the most used surface of the app. Plain text inputs make users remember field names, operator spelling and mongosh constructors; Compass and Studio 3T suggest all of them while typing. Suggestions need the collection's field paths, which MongoDB does not store anywhere: they must be inferred from documents.

## Decision

- **Field paths come from a sample.** `schema::sample_fields` in core runs `$sample` (200 documents from the UI, at most 1000) and returns each dot-notation path with the BSON types seen and the share of documents containing it, most common first. Fields of documents inside arrays share the array's path (`items.sku`), as in query dot notation. Depth (6) and path count (1000) are bounded. Sampling is a read, so it is allowed on read-only connections. The UI caches it with TanStack Query for 5 minutes per collection.
- **Editors are single-line CodeMirror**, sharing the lazily loaded CodeMirror chunk and highlight style with the document editor. Enter runs the query unless a suggestion list is open; pasted newlines become spaces.
- **Suggestions depend on the cursor's context**, computed by a tolerant scanner (`lib/query-context.ts`) that tracks nesting, keys and strings without needing the rest of the text to be valid:
  - key of the top-level document, or of a `$and`/`$or`/`$nor` branch: fields, then logical operators;
  - key inside a field's condition: field operators; inside `$elemMatch`: the array's sub-fields and field operators;
  - value: mongosh constructors (the one matching the field's sampled type first) and literals; `$type` names and `$exists` booleans;
  - sort and projection: fields, then `1`/`-1` or `1`/`0`.
  Operators and constructors are snippets with a localized one-line description.
- **Braces are optional**: `status: "active"` is parsed as `{ status: "active" }`.
- **Query history** keeps the last 50 successful queries per profile and collection, newest first, without duplicates. It is UI state persisted in `localStorage` (Zustand `persist`), searchable from the query bar.

## Alternatives considered

- **Field names from the rows on screen** — free, but limited to the current page and projection, and empty before the first query.
- **Full schema analysis** (every document, like Compass's Schema tab) — accurate but expensive on large collections; a separate feature, not something to run while typing.
- **The JavaScript language's own completion** — knows nothing about MongoDB operators or fields.
- **History in the core SQLite store** — survives a webview storage reset and could follow profile deletion, but needs migrations and IPC for what is today a convenience list. Revisit when history gains favorites or sync.

## Consequences

- Fields absent from the sample are not suggested; users can still type them.
- The operator catalog lives in `lib/query-completion.ts` and must grow with MongoDB releases.
- History entries of deleted profiles stay in `localStorage` until cleared; they are never shown for another profile.
