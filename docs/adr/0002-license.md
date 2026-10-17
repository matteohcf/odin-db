# 0002. License: MIT OR Apache-2.0

- Status: Accepted
- Date: 2026-10-17

## Context

The license must be fixed before the first public commit; changing it later requires consent from every contributor. Everything we redistribute (MongoDB Rust driver, MongoDB Database Tools, mongosh) is Apache-2.0, so all candidates are compatible. `crates/core` is designed as a standalone library and should be reusable.

## Decision

Dual license **MIT OR Apache-2.0**, the Rust ecosystem convention. Files: `LICENSE-MIT`, `LICENSE-APACHE`. Copyright holder: "Matteo Carrara and the odin-db contributors". Contributions are accepted under the same terms (inbound = outbound), stated in `CONTRIBUTING.md`; no CLA.

## Alternatives considered

- **MIT only** — no explicit patent grant; less idiomatic for a Rust crate.
- **GPL-3.0** — prevents closed forks, but deters corporate contributors and makes `crates/core` unusable in permissive projects. Commercial-fork risk for a free desktop client is low.
- **MPL-2.0** — reasonable middle ground, but unusual in the Rust ecosystem and offers little extra here.

## Consequences

Anyone may fork, including commercially. `cargo-deny` enforces that dependencies stay compatible with both licenses.
