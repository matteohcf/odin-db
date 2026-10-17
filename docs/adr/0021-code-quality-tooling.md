# 0021. Code quality tooling and conventions

- Status: Accepted
- Date: 2026-10-17

## Context

An open source project needs automated, uniform quality gates so review focuses on design, not style.

## Decision

**Rust**: `rustfmt`; `clippy --all-targets -- -D warnings` with a workspace lint table in `Cargo.toml`; `cargo-deny` (advisories, licenses compatible with MIT/Apache-2.0, banned duplicate-heavy crates, allowed sources); edition 2024; toolchain pinned in `rust-toolchain.toml`.

**TypeScript**: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`; **Biome** for lint and format (single fast tool); **knip** for unused files, exports and dependencies; shared `tsconfig.base.json`.

**Git**: Conventional Commits enforced by commitlint; **lefthook** runs format and lint on staged files (pre-commit) and commitlint (commit-msg). Hooks are a convenience; CI is the gate.

**Dependencies**: Renovate with grouped updates and a weekly schedule; lockfiles committed; exact pins for release-candidate crates (ADR-0005).

**Repo hygiene**: `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` (Contributor Covenant), `SECURITY.md`, issue and PR templates, `CODEOWNERS`.

## Alternatives considered

- **ESLint + Prettier** — two tools and slower; Biome covers our needs.
- **oxlint** (used by t3code) — excellent linter, but its formatter is younger; Biome gives lint and format in one mature tool.
- **husky** — lefthook is faster and language-agnostic (useful with Rust in the repo).

## Consequences

`pnpm check` runs every gate locally exactly as CI does.
