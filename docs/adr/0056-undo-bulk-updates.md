# 0056. Undoing bulk updates and field changes

- Status: Accepted
- Date: 2026-10-25

## Context

Deleting documents and editing one field already offer Undo. A bulk update or a field change
(ADR-0054) rewrites many documents at once, and a mistake there is the costly kind. Studio 3T
can keep the original values to restore them.

## Decision

- `documents::update_many` and `change_field` read the documents they are about to write
  (the same filter) and return them as `originals`, up to `UNDO_LIMIT` (1,000). Past it they
  return none, and the dialogs say beforehand that the change cannot be undone.
- `restore_documents` replaces each original by `_id`; read-only is refused in Rust.
- The confirmation toast offers Undo for 10 seconds, like a delete.

## Alternatives considered

- **A persistent history of changes** — storage, retention and conflict rules for a rare need;
  the immediate Undo covers the common mistake.
- **Undo by inverting the operation** — a `$set` or `$convert` has no exact inverse; the
  originals do.

## Consequences

- Undo puts back the whole documents as they were: a change someone else made to them in
  the meantime is overwritten.
- A large bulk update reads up to 1,000 documents first, a small cost for the safety.
