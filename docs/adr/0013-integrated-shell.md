# 0013. Integrated shell: hybrid model

- Status: Accepted
- Date: 2026-10-17

## Context

"Shell" covers two needs: everyday querying with results in a grid, and full mongosh compatibility (scripts, helpers, admin commands such as `rs.status()`).

## Decision

Two tools, each doing one job:

1. **Native query editor** (ADR-0012): queries and pipelines executed by the Rust driver, results in the grid. This is required for V1 anyway.
2. **mongosh terminal**: real mongosh in a PTY (`portable-pty`, from WezTerm, handles ConPTY on Windows) owned by `crates/core::shell`, rendered with xterm.js. Output and input flow over the operation's channel / commands (ADR-0006).

Credential handling: the password is **never passed as a command-line argument** (visible in process lists). mongosh is started with a URI that has no password and `--password` without a value, and core writes the password to the PTY when mongosh prompts. Sessions are terminated when the tab closes or the connection is closed.

## Alternatives considered

- **PTY + mongosh only** — text-only output, no grid; the feature disappears without mongosh.
- **Custom console reimplementing the mongosh API** (embedded JS engine) — permanent partial compatibility and endless maintenance.

## Consequences

Two surfaces, but the query editor is needed regardless; the terminal adds full compatibility at low cost. mongosh availability is handled by ADR-0014.
