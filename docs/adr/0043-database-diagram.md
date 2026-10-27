# 0043. Database diagram

- Status: Partly superseded by 0060
- Date: 2026-10-24

## Context

MongoDB has no declared foreign keys, so neither Compass nor Studio 3T shows how the collections
of a database relate. Users want a picture of their architecture: which collections exist, what
their documents look like, and which fields point at which collection.

## Decision

- A database opens a **diagram tab** (`diagram:<profile>/<database>`): one node per collection or
  view with its sampled fields and types, and one edge per inferred reference.
- `diagram::database_diagram` in core samples up to 100 documents per collection (`$sample`,
  bounded concurrency) and summarizes their fields with the schema sampler.
- References are **inferred from data, not names**: every ObjectId-valued path (also inside
  arrays and nested documents, `_id` excluded) keeps up to 40 sampled values, which are looked up
  with `{ _id: { $in } }` in candidate collections. Collections whose name matches the field
  (`userId`, `user_id`, `users`) are tried first; when none matches and the database is small,
  every collection is tried. An edge needs at least half of the sampled values to exist in its
  target; it records how many matched and whether the field is an array (one-to-many).
- It runs as a registered, cancellable operation with lossy progress.
- The UI draws it with **React Flow** (`@xyflow/react`, MIT) laid out by **dagre**
  (`@dagrejs/dagre`, MIT). Node positions the user drags are kept per database in local storage.

## Alternatives considered

- **Name conventions only** — cheap, but wrong for `owner`, `createdBy` or legacy names, and it
  cannot tell a dangling reference from a real one.
- **A hand-written SVG canvas** — no dependency, but pan, zoom, minimap, keyboard access and edge
  routing are a lot of code to own.
- **Graphviz or ELK layout** — better for huge graphs, but heavier; dagre handles the tens to
  low hundreds of collections a database has.

## Consequences

- Sampling means rare fields and rarely used references may be missed; the UI says it is a
  sample and offers to analyze again.
- Two new JavaScript dependencies, loaded only with the diagram tab.
