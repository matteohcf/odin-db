# 0001. Record architecture decisions

- Status: Accepted
- Date: 2026-10-17

## Context

odin-db is a public open source project. Contributors (human and AI agents) need to understand why the codebase is shaped the way it is, without archaeology in issues or chat logs.

## Decision

Every significant architectural decision is recorded as an ADR in `docs/adr/`, using `template.md`. ADRs are numbered sequentially and immutable once accepted; a change of direction is a new ADR that supersedes the old one. `CLAUDE.md` summarizes the rules and links to the ADRs.

"Significant" means: affects module boundaries, the IPC contract, data correctness, security, a new runtime dependency with wide reach, or the release process.

## Alternatives considered

- **Wiki / external docs** — drifts from the code, not reviewed in PRs.
- **No formal record** — decisions get re-litigated and silently eroded.

## Consequences

Architectural PRs include an ADR. Reviewers can reject code that contradicts an accepted ADR.
