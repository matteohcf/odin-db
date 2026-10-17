# 0012. Query editor syntax and aggregation builder

- Status: Accepted
- Note (2026-10-17): `ejson-shell-parser` was renamed `@mongodb-js/shell-bson-parser`; the decision is unchanged.
- Date: 2026-10-17

## Context

Users expect to type shell-style queries (`{ _id: ObjectId("…"), createdAt: { $gt: ISODate("…") } }`). Strict JSON is hostile, and evaluating arbitrary JS in the UI is a security and correctness hazard.

## Decision

- The query editor accepts **shell syntax** parsed by `ejson-shell-parser` (mongodb-js, Apache-2.0, used by Compass). It parses to an AST and only allows a safe whitelist of constructors; **no `eval`**. Output is converted to canonical EJSON (ADR-0007) before crossing IPC.
- Rust re-validates every filter, projection, sort and pipeline it receives (trust boundary).
- Autocomplete: operators, stages and field names. Field names come from a sampled schema (`$sample`, bounded size) cached per collection.
- **Aggregation builder**: the pipeline is an ordered list of stages; each stage has its own CodeMirror editor, an enable toggle, and a preview of its output computed with `$limit` on a sample. The pipeline can be viewed and edited as a whole and exported as code (shell, Node, Python, Rust snippets: later).
- `explain()` available from the editor for queries and pipelines.

## Alternatives considered

- **Strict JSON / EJSON only** — correct but unpleasant for daily use.
- **Evaluating JS** (embedded engine) — attack surface and endless compatibility work; full JS belongs to the mongosh terminal (ADR-0013).

## Consequences

The editor supports what the parser supports; anything needing real JavaScript goes to the shell.
