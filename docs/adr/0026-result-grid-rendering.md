# 0026. Result grid rendering

- Status: Accepted (refines ADR-0011)
- Date: 2026-10-17

## Context

Rendering grid cells through TanStack Table's row model (`row.getAllCells()`) memoizes cell objects for every visited row. With tens of thousands of documents this doubled webview memory and broke the frame budget (docs/milestone-0.md, finding 2).

## Decision

- The grid is a virtualized `<table role="grid">` laid out with CSS grid (WAI-ARIA data grid pattern): focus stays on the table, the selected row is exposed through `aria-activedescendant`, rows are keyboard navigable (arrows, Page Up/Down, Home/End, Enter to open, Delete to remove).
- **TanStack Table owns the column model** (headers today; sizing, order and visibility next). **Cells render straight from the documents** by field name.
- Each column shows its dominant BSON type, sampled from the first loaded documents, with a type glyph and a width suited to the type.
- Cells show the compact value (no quotes, no `ObjectId(…)` wrapper, UTC timestamps); the exact mongosh form is in the cell tooltip and in the editor. Nested documents and arrays are summarized.

## Consequences

Features that need per-cell state (inline editing) must keep it outside the table's row model, keyed by row index and field.
