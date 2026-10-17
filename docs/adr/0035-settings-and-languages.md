# 0035. Settings and languages

- Status: Accepted
- Date: 2026-10-17

## Context

Values such as the result page size, the shell font size or the query history
length were constants spread across features. Users need to change them, and
the list will keep growing: the settings must stay easy to extend and reach
every feature without breaking the one-way feature dependencies. The app also
ships a second language, Italian, so translations must not silently fall behind
the English source.

## Decision

- Preferences live in one typed, flat Zustand store persisted to `localStorage`:
  `useSettings` in `src/lib/settings.ts`. Each field has a default in
  `DEFAULT_SETTINGS`; persisted state from older versions is merged over the
  defaults, so adding a field needs no migration. Renaming or changing the
  meaning of a field bumps the store version with a `migrate`.
- Being in `src/lib`, the store is readable by any feature. Code that only needs
  the value at use time reads `useSettings.getState()` (results paging, query
  history), so changes apply to the next use without re-rendering.
- Window-wide effects are applied in one place, `useApplySettings`: language
  (`i18next.changeLanguage`), zoom (the webview's own zoom through
  `setZoom`, CSS zoom in the browser preview), and the editor font size through
  the `--editor-font-size` CSS variable.
- The settings UI is a single workspace tab (`features/settings`) with one page
  per area. A new page is an entry in `PAGES` and a section component; a new
  setting is a field, a `SettingRow` and a reader.
- The theme keeps its own provider and storage (`packages/ui`), shown on the
  appearance page; it predates the store and must apply before React renders.
- Languages are listed in `resources` in `src/lib/i18n.ts`. "System" follows
  the OS language when it is supported, otherwise English. Every `en.json` has
  an `it.json` with the same keys, enforced by `src/lib/locales.test.ts`.

## Alternatives considered

- **Settings in SQLite through the backend** — needed only for settings Rust
  must read (none today). When one appears, it becomes a backend setting with
  its own command; UI preferences stay in the UI store.
- **One store per feature** — no single place to list, reset or extend the
  settings, and a settings page would depend on every feature's internals.
- **Lazy-loaded locales** — the locales are small; bundling them keeps language
  switching instant and offline.

## Consequences

- Settings are per machine and per OS user, like the rest of the UI state.
- Every user-visible string now needs an Italian translation in the same change;
  CI fails otherwise.
