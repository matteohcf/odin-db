# 0041. Collection compare

- Status: Accepted
- Date: 2026-10-18

## Context

Users keep copies of the same data in several places (staging and production, a collection
and its backup copy) and need to know whether they match and where they differ. Comparing two
selected documents existed; comparing collections did not.

## Decision

- Documents are matched by `_id`. Two passes keep memory bounded at any size: the left side
  is read in batches of 1000, each batch looked up on the right with `$in`; then only the right
  side's `_id`s are read and looked up on the left, to find documents the left lacks. Matching
  uses the server's own equality, so no client-side BSON ordering is needed.
- Two documents are identical when they have the same fields with equal values, in any field
  order; types matter (`1` and `Long(1)` differ), and so does array order.
- An optional filter limits both sides. Counts are complete; the first 200 `_id`s of each group
  are returned for the UI, and a differing document opens in the existing field-by-field view.
- It runs as a registered, cancellable operation with lossy progress, from the collection menu
  ("Compare with…"), against any open connection.

## Alternatives considered

- **Merge join over both sides sorted by `_id`** — one pass, but needs a client comparator that
  matches the server's cross-type sort order exactly.
- **Hashing every document in memory** — simple, but unbounded memory on large collections.

## Consequences

- Each side is read once in full and the right side a second time for its `_id`s only.
- A numeric `_id` stored as different types on the two sides (`1` and `Long(1)`) counts as
  missing on the right, since the server matches it but the documents differ in type.
- **Sync** applies a comparison to the right side, choosing per kind: insert missing documents,
  replace differing ones with the left version, delete documents only the right has. Deleting
  is off by default and needs the target collection's name typed back; a read-only target is
  refused in Rust. Sync reuses the compare scan (`Visitor`), then the UI compares again so the
  counts show what is left.
