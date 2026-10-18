# 0037. Large deployments

- Status: Accepted
- Date: 2026-10-18

## Context

People who work on multi-tenant clusters open connections with hundreds of
databases and databases with thousands of collections. Measured on such a
deployment (320 databases, one with 2,500 collections), the nested component tree
took 3 s and 53,000 DOM nodes to expand one database, a 300-field collection put
300 cells in every grid row, and searching the sidebar or the palette fired one
`listCollections` per database at once, filling the driver's pool so the user's own
queries waited behind it.

## Decision

- **The connection tree is one flat, virtualized list.** `buildTreeRows` turns
  groups, profiles, databases and collections into rows; `TreeList` renders only
  those in view. A row component never renders its children. Catalog queries are
  gathered by `useTreeRows`, not by the rows.
- **The grid virtualizes columns as well as rows.** Columns out of view become one
  spacer per run (`columnSlots`); sticky (`_id`, pinned) and edited columns always
  render.
- **Catalog-wide reads are one request with bounded concurrency.** `browse::catalog`
  lists every database's collections at most 4 at a time; the sidebar filter and
  the palette use it and seed each database's collection list from it.
  `collection_counts` runs 4 at a time and skips databases over 1,000 collections.
- **Tab panels are memoized**, so switching tabs re-renders only the two panels
  whose visibility changes.
- **Heavy libraries load on first use**: CodeMirror (through the completion source),
  the shell parser and bson are dynamic imports, keeping them out of startup.

## Alternatives considered

- **Virtualizing each nested list inside the existing tree** — nested virtualizers in
  one scroll container need offsets that change whenever anything above expands;
  a flat list is simpler and handles every level the same way.
- **Paging long lists ("show 200 more")** — fast, but it hides collections and breaks
  scrolling and keyboard navigation through a database.
- **A larger connection pool** — hides the burst instead of avoiding it, and costs
  server connections per user.

## Consequences

- Rows that scroll out of view unmount: per-row state (an open menu, a dialog) must
  not need to outlive scrolling. Dialogs are modal, so this holds today.
- Tests and code cannot assume every tree row or grid cell is in the DOM; they scroll
  first (`focusRow`, `scrollToIndex`).
- Databases with more than 1,000 collections show no document counts.
- Browser suites guard this: include a 320-database mock
  cluster, 40 open tabs and 300-field documents with time and DOM budgets.
