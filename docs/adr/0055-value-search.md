# 0055. Searching values across collections

- Status: Accepted
- Date: 2026-10-25

## Context

"Where is this e-mail / code / name stored?" is a common question on an unfamiliar database.
Studio 3T answers it with Search In, across a server, a database or a collection. A query needs
the field to be known; the server has no way to match text in every field.

## Decision

- `search::search` reads documents and matches here: string values, and ObjectIds and numbers
  by their text so an id finds the documents referencing it (inside embedded documents and
  arrays, array positions in the path) and, when asked, field names; plain text is literal,
  a regular expression uses the `regex` crate, case-insensitive by default.
- It reads at most `documentsPerCollection` per collection (1,000 by default; 10,000 or 100,000
  on request) and reports the collections it did not read in full, so a miss is never presented
  as an absence. Views and `system.*` collections are skipped (views repeat their source), and so
  are `admin`, `local` and `config` when the whole server is searched. It stops at 1,000 hits.
- It runs as a cancellable streaming operation: progress (`scanning`) is lossy, hits are sent per
  collection and never dropped, then one `finished` with the totals.
- The connection and database menus open `ValueSearchDialog`; a hit opens its collection
  filtered by `_id`.

## Alternatives considered

- **`$where` or `$expr` on the server** — JavaScript is often disabled, and neither walks unknown
  fields; reading documents is what Studio 3T does too.
- **Text indexes** — need one per collection, created beforehand, and only cover chosen fields.

## Consequences

- A search reads documents over the network: the per-collection limit keeps a server-wide search
  bounded, at the price of reporting partial coverage.
