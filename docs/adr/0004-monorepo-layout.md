# 0004. Monorepo layout and boundaries

- Status: Accepted
- Date: 2026-10-17

## Context

The project spans Rust and TypeScript. Boundaries must be structural (enforced by the dependency graph), not conventional, so the codebase stays maintainable as contributors join. Inspiration: pingdotgg/t3code (clear package boundaries, a shared typed contract, a thin transport layer).

## Decision

One repository with **pnpm workspaces** (JS), a **Cargo workspace** (Rust) and **Turborepo** (JS task orchestration and caching).

```
apps/desktop          React UI + src-tauri (thin Tauri host)
crates/core           MongoDB and domain logic, no Tauri dependency
packages/ui           shared shadcn/ui components
packages/bindings     TS types generated from Rust (ADR-0005)
```

Package names: npm `@odin-db/desktop`, `@odin-db/ui`, `@odin-db/bindings`. Crates: `odin-core`, `odin-desktop` (src-tauri). App identifier: `io.github.matteohcf.odin-db` (**permanent**: changing it breaks updates and stored keyring entries).

Rules:
- `crates/core` must not depend on any `tauri*` crate.
- `src-tauri` contains only thin commands, state wiring, sidecar path resolution.
- `packages/ui` has no app logic and does not import `apps/*` or `packages/bindings`.
- `crates/core` is **one crate with domain modules**. Split into more crates only when compile times or real external reuse justify it; record the split in an ADR.
- Versions: Rust toolchain in `rust-toolchain.toml`, Node and pnpm in `package.json` (`packageManager`, `engines`), shared JS dependency versions through the pnpm catalog.

## Alternatives considered

- **Separate repositories** — contract changes would span repos and releases; no atomic changes.
- **Many fine-grained crates from day one** (as t3code has many packages) — t3code's split follows real multiple implementations (providers, source-control hosts). We have one of each; splitting now is speculative.
- **Nx** — heavier than needed; Turborepo covers caching and task graphs.

## Consequences

Rust tasks run through `cargo` and are wrapped by root scripts (`pnpm check`). Turborepo caches JS tasks only.
