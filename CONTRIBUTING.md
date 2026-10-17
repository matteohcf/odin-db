# Contributing to odin-db

Thanks for helping. This guide covers setup, workflow and what a PR needs to be merged.

## Setup

1. Install Node.js 22+, pnpm 10, Rust via [rustup](https://rustup.rs) and the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS.
2. `pnpm install` (also installs the git hooks via lefthook).
3. `pnpm dev` to run the app.

Integration tests need Docker: `pnpm test:integration`.

## Before you code

- Read [CLAUDE.md](CLAUDE.md): repository layout, dependency rules and conventions.
- Check [`docs/adr`](docs/adr/README.md) for the area you touch. A change that contradicts an accepted ADR needs a new ADR that supersedes it, discussed in an issue first.
- For anything larger than a small fix, open an issue to agree on the approach.

## Workflow

- Branch from `main`. One logical change per PR.
- Commits and PR titles follow [Conventional Commits](https://www.conventionalcommits.org): `feat(core): ...`, `fix(desktop): ...`. Scopes: `core`, `desktop`, `ui`, `bindings`, `ci`, `deps`, `docs`. Release notes are generated from them.
- Changed a Rust type or command used by the UI? Run `pnpm bindings` and commit the result. CI fails if bindings are stale.
- Run `pnpm check` before pushing. It runs the same gates as CI.

## Pull request checklist

- [ ] Tests cover the change; bug fixes include a test that fails without the fix.
- [ ] User-visible strings go through i18next.
- [ ] No secrets, connection strings or document contents in logs or errors.
- [ ] New dependencies are justified in the PR description.
- [ ] Docs or ADRs updated when behavior or architecture changes.

## Licensing

By contributing, you agree that your contributions are licensed under the project's terms, MIT OR Apache-2.0, without additional terms or conditions (inbound = outbound). No CLA is required.
