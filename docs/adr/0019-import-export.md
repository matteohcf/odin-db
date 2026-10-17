# 0019. Import/export streaming

- Status: Accepted
- Date: 2026-10-17

## Context

Import and export can involve gigabytes. They must not load everything in memory, must report progress, be cancellable, and preserve types.

## Decision

- Implemented in `crates/core::transfer`, streaming end to end: cursor → serializer → file for export; file → parser → batched `insertMany`/`bulkWrite` for import.
- Formats: JSON array, NDJSON (default for large data) and CSV (`csv` crate). JSON formats use canonical EJSON by default (ADR-0007), relaxed only on explicit choice.
- CSV: export with field selection and dotted paths for nested fields; import with column → field mapping and explicit type per column (no silent type guessing for ambiguous values).
- Import options: ordered/unordered, batch size, stop or continue on error with an error report file.
- Progress (documents, bytes, rate) and cancellation via the standard long-operation contract (ADR-0006). Cancelled exports delete partial files; cancelled imports report what was already written.
- Export can start from any query or pipeline result.

## Alternatives considered

- **Using mongoexport/mongoimport sidecars** — extra binaries, weaker progress integration and error reporting; dump/restore stays on the tools (ADR-0015) because there the format fidelity is what matters.

## Consequences

Round-trip tests (export → import → compare) for every format and BSON type.
