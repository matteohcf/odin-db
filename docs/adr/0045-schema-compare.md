# 0045. Schema compare

- Status: Accepted
- Date: 2026-10-24

## Context

Collection compare (ADR-0041) answers whether the data matches. Teams with several environments
(local, staging, production) more often need to know whether the structure matches: a missing
index or a field written with another type breaks a release before any data does.

## Decision

- `schema_compare::compare_schemas` compares two databases, on the same or different
  connections, as a registered, cancellable operation with progress per collection.
- Collections are matched by name; one present on a single side is reported, not inspected.
  Views are matched by name only.
- For collections on both sides it samples 200 documents each (the schema sampler) and lists the
  fields missing on one side or holding other types; a field seen in under 5% of one side's
  sample and absent from the other is treated as sampling noise.
- Indexes are matched by their keys, in order, whatever their names; a pair differs when unique,
  sparse, hidden, TTL or the partial filter differ.
- Validation rules are compared when both sides can read them.
- The dialog opens from the database menu, lists only differences by default, and creates a
  missing index on the other side with its name and options (writable connections only), one by
  one or all at once.

## Alternatives considered

- **Comparing `$jsonSchema` validators only** — most collections have none.
- **Full scans instead of samples** — exact, but too slow on large production collections.

## Consequences

- Field differences are sample-based, so rare fields can be missed; indexes and rules are exact.
