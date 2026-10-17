# 0032. Aggregation stage assistance

- Status: Accepted (extends ADR-0031)
- Date: 2026-10-17

## Context

ADR-0031 added context-aware suggestions to the query bar. Aggregation stage bodies are written in the same syntax and need them even more: field references (`"$price"`) and accumulators are easy to mistype. Unlike the query bar, a stage does not see the collection's fields: `$group`, `$project` or `$unwind` reshape documents before the next stage.

## Decision

- The document editor accepts a `completions` source; stage cards pass one per operator: `$match` uses filter suggestions, `$sort` sort, `$project` projection, every other stage a new **expression** kind: fields for top-level keys, accumulators and expression operators inside a new field, `"$field"` references inside strings.
- **A stage's fields are its input**: the output of the previous enabled stage, derived from that stage's cached preview with `fieldPathsOf` (the frontend twin of `schema::sample_fields`, used by the mock backend too). The first stage, or a stage whose previous preview is not available yet, uses the collection sample.
- Snippets that leave the cursor in a `"$…"` string reopen the list with field references.
- Completion sources, their localized descriptions (`common:queryAssist`) and their styling are shared by every editor (`useQueryCompletions`, `completionTheme`).

## Alternatives considered

- **Collection fields for every stage** — simple, but wrong after any reshaping stage, which is exactly where help is needed.
- **Inferring output fields statically from each stage's body** — would duplicate the server's semantics for dozens of operators; the preview already has the real answer.

## Consequences

- Suggestions for stage N need stage N-1's preview: they appear a moment after edits upstream, and fall back to collection fields meanwhile.
- Previews are capped at 20 documents, so rare fields of a stage's output may be missing.
