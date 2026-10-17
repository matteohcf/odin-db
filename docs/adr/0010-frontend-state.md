# 0010. Frontend state and feature structure

- Status: Accepted
- Date: 2026-10-17

## Context

The UI holds three kinds of state: backend data fetched by request/response, streamed data (query results, logs, progress), and pure UI state (tabs, layout, selection). Mixing them leads to duplicated caches and stale data.

## Decision

- **TanStack Query** owns backend request/response data (databases, collections, indexes, profiles). Query keys are built by per-feature key factories. Mutations invalidate precisely.
- **Zustand** owns UI-only state: open tabs, layout, selection, editor drafts. Backend data is never copied into Zustand.
- **Streaming results** live in a per-tab store (Zustand slice keyed by tab) fed by the operation's channel. Incoming batches are buffered and flushed **once per animation frame** to avoid render storms.
- **No router**: the app is a tab workspace. Settings and dialogs are overlays.
- **Feature folders**: `src/features/<name>/{api,components,hooks,store}`. `api/` wraps `packages/bindings` with Query hooks. Features never import another feature's internals; shared code moves to `src/lib` or `packages/ui`.
- Tabs and layout are persisted to local storage so the workspace restores on restart (not results).

## Alternatives considered

- **Redux Toolkit** — more ceremony; RTK Query would overlap TanStack Query.
- **Results in the Query cache** — Query models request/response, not open-ended streams with cancellation.
- **TanStack Router** — URL routing adds nothing to a tab-based desktop workspace.

## Consequences

Clear ownership: if it comes from Rust, it is Query or a stream store; if it only exists in the UI, it is Zustand.
