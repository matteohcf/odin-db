# 0047. Diagram annotations

- Status: Accepted
- Date: 2026-10-24

## Context

The database diagram (ADR-0043) infers references from sampled data. Sampling misses references
held as strings, in rare fields, or across databases, and occasionally finds one that is a
coincidence. Users also want to explain parts of their architecture on the diagram itself.

## Decision

- A user can **draw a reference** by dragging a field's handle onto another collection, **hide an
  inferred reference** they know is wrong, and add **notes**.
- These annotations live in the UI, persisted in local storage per `profileId/database`
  (`useAnnotations`), next to dragged positions. Nothing is written to the database.
- `annotate` merges them with the analysis at render time: hidden inferred references are left
  out, drawn ones are added unless the analysis already found them, and drawn references to
  collections that no longer exist are skipped, not deleted.
- Drawn references are dashed and labelled as drawn, so they never pass for something found in
  the data. They are included in the Mermaid export.
- The automatic layout uses only the analysis' references, so annotating never rearranges the
  diagram.

## Alternatives considered

- **Storing annotations in the database** (a `_odin` collection) — shareable with the team, but
  writes to a database the user only meant to look at, and read-only profiles could not annotate.
- **Name-based hints** to catch string references — guesses; drawing one by hand is explicit.

## Consequences

- Annotations are per machine; they are not shared and do not follow the database to another
  profile.
