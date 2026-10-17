# 0007. BSON over IPC: canonical Extended JSON

- Status: Accepted
- Date: 2026-10-17

## Context

BSON has types JSON lacks (`ObjectId`, `Date`, `Int32`/`Int64`/`Double`/`Decimal128`, `Binary`, `Timestamp`, `Regex`, `MinKey`/`MaxKey`). JS numbers are IEEE-754 doubles. If an `Int64` reaches the UI as a plain number and the user saves the document, it silently becomes an `Int32` or `Double`; beyond 2^53 it also loses precision, and `Decimal128` gets rounded. A database client that silently changes stored types is corrupting data.

## Decision

- Documents cross IPC as **canonical Extended JSON v2** (`{"$numberLong": "5"}`, `{"$oid": "…"}`). The Rust `bson` crate produces it natively; on the TS side it is typed as JSON under an `EJsonDocument` alias.
- The UI parses and serializes with the official `bson` npm package (`EJSON`, `relaxed: false`). Edits round-trip with exact types.
- Display (grid, tree): shell-style rendering (`ObjectId("…")`, `NumberLong(5)`, `ISODate("…")`), type-aware cells.
- Relaxed EJSON is allowed **only** in user-facing export when the user explicitly chooses it.
- Correctness is guarded by round-trip tests covering every BSON type, including edge values (`Int64` max, `-0.0`, `NaN`, `Decimal128`, nested arrays).

## Alternatives considered

- **Relaxed EJSON** — readable but lossy; causes the corruption described above.
- **Custom typed tree (`BsonValue` enum via specta)** — a second proprietary format to maintain while EJSON is still needed for the editor and import/export.
- **Raw BSON bytes (`tauri::ipc::Response` + js-bson)** — fastest, but bypasses specta typing and complicates debugging. Premature; may be added later for bulk streaming only if benchmarks demand it, without changing the rest of the contract.

## Consequences

Payloads are 30–50% larger than relaxed JSON, negligible over local IPC. One parsing path in the UI.
