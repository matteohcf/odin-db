# 0028. Aggregation builder

- Status: Accepted (details ADR-0012)
- Date: 2026-10-17

## Context

ADR-0012 sets the builder's shape: an ordered list of stages, each with its own editor and a preview. Implementing it raised questions ADR-0012 left open: how previews stay cheap on large collections, how write stages are kept safe, and how stage text maps to BSON.

## Decision

- **Stage text** is the operator's argument in mongosh syntax and is parsed as `{ <operator>: <argument> }`, so numbers (`$limit: 10`), strings (`$unwind: "$tags"`) and documents all work with the same parser (ADR-0012).
- **Previews** run `stages[0..=i]` through `preview_aggregation`, which returns at most 20 documents and keeps no cursor. They read a **sample**: the UI prepends `{ $limit: 1000 }`, except when the first stage must stay first (`$geoNear`, `$search`…). The preview header says so, since sampled `$group`/`$count` results can differ from a full run. Previews are TanStack queries keyed by the stage texts, debounced by 400 ms and cached, so unchanged prefixes are not re-run.
- **Write stages** (`$out`, `$merge`) are never previewed; the backend refuses them in `preview_aggregation` too (trust boundary). Running a pipeline with a write stage asks for confirmation, and is refused on read-only connections both in the UI and in core.
- **Full runs** use `aggregate_documents`, paged with the same cursor contract as `find` (ADR-0025) and shown in the shared results grid as view-only rows (they need not be documents of the collection).
- A syntax error in stage *n* is shown in stage *n*; later stages explain that stage *n* must be fixed first.

## Consequences

Sampling trades exactness for speed on previews only; full runs are always exact. A future "sample size" setting can change the 1,000-document default without touching the contract.
