# 0011. UI component stack

- Status: Accepted
- Date: 2026-10-17

## Context

A professional data tool needs accessible primitives, fast virtualized grids, a capable code editor and a terminal, all actively maintained.

## Decision

- **shadcn/ui** (Radix + Tailwind CSS) in `packages/ui`. Components are owned source code, themed with CSS variables.
- **TanStack Table + TanStack Virtual** for result grids and tree views (row and column virtualization).
- **CodeMirror 6** for query, aggregation stage and document editors.
- **xterm.js** (WebGL renderer with canvas fallback) for the mongosh terminal (ADR-0013).
- **Lucide** icons.
- **cmdk** (via shadcn) for the command palette.

## Alternatives considered

- **AG Grid** — powerful, but key features are commercial and its styling clashes with the design system.
- **Monaco** — heavier and harder to embed than CodeMirror 6, and less friendly to WebKit webviews.
- **MUI / Mantine** — opinionated styling and a runtime styling cost; shadcn gives owned, auditable components.

## Consequences

Grid features (inline edit, column resize, type-aware cells) are built by us on top of TanStack primitives. Performance is validated in Milestone 0 (ADR-0003).
