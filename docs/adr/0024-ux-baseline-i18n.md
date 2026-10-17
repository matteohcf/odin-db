# 0024. UX baseline and i18n

- Status: Accepted
- Date: 2026-10-17

## Context

A professional tool is judged on keyboard efficiency, accessibility and polish. Retrofitting i18n into hard-coded strings later is expensive.

## Decision

- **Themes**: light, dark, system; design tokens as CSS variables in `packages/ui`.
- **Keyboard-first**: every action reachable by keyboard; a command palette (`cmdk`); a central shortcut registry (no ad-hoc key listeners) with platform-aware modifiers; shortcut cheat sheet.
- **Accessibility**: Radix primitives, visible focus, WCAG AA contrast in both themes, accessible names on icon buttons, grid keyboard navigation.
- **Workspace**: connection tree sidebar, tabbed editors/results, restorable layout (ADR-0010).
- **States**: every async view has loading, empty and error states. Errors show the `IpcError` message plus an actionable hint where possible.
- **i18n**: English UI for V1, but **every user-visible string goes through i18next** (`react-i18next`) from day one, with typed keys. Locale files per feature. Translations are community contributions.
- Native OS behaviors: menus, window state persistence, file dialogs, and a quit confirmation when operations are running.

## Alternatives considered

- **Hard-coded English, i18n later** — every string must be touched again; translations are blocked meanwhile.
- **Lingui** — good, but i18next is more widely known by contributors.

## Consequences

PRs with raw user-visible strings fail review (and a lint rule where feasible).
