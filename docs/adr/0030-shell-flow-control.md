# 0030. Shell sessions and flow control

- Status: Accepted (details ADR-0013 and ADR-0014)
- Date: 2026-10-17

## Context

The integrated shell runs real mongosh in a PTY rendered by xterm.js (ADR-0013). Milestone 0 showed that a Tauri `Channel` has no consumer acknowledgement: output pushed faster than xterm.js parses it piles up in webview memory, and past ~50 MB xterm.js discards data (docs/milestone-0.md, finding 1). A shell can easily produce that much (`db.big.find()` in a loop).

## Decision

**Credit-based flow control, end to end:**

- `crates/core::shell` owns the PTY (`portable-pty`) and reads it on a blocking thread in chunks of up to 16 KiB.
- Every chunk sent to the UI is counted as *unacknowledged*. When unacknowledged output exceeds the high watermark (512 KiB), the reader stops reading the PTY. The kernel PTY buffer then fills and mongosh blocks on write, so the producer itself slows down. No unbounded queue exists anywhere.
- The UI writes each chunk to xterm.js with a completion callback and acknowledges the bytes once parsed (`shell_ack(session, bytes)`, batched). Reading resumes when unacknowledged output drops below the low watermark (128 KiB).
- Input (`shell_write`), resize (`shell_resize`) and close (`shell_close`) are plain commands; output is a `Channel<ShellEvent>` (`output` chunks, then exactly one `exited` with the exit code).

**Sessions:**

- A shell tab is a workspace tab kind (`shell`) bound to a profile; sessions end when the tab closes, the connection is closed, or mongosh exits.
- mongosh starts with the sanitized URI and, if the profile has a password, `--password` without a value; core answers the password prompt through the PTY (the password never appears in arguments or the environment). `--quiet` hides the banner; the UI shows its own header.
- Resolution of the mongosh binary follows ADR-0014: configured path, then `PATH`, then a verified download (the download lands in a later step; until then the UI explains how to install mongosh).
- Read-only profiles cannot be enforced inside mongosh; the shell tab shows a warning and recommends a read-only database user (ADR-0017).

## Alternatives considered

- **Unbounded push with xterm.js watermarks only** (what the Milestone 0 benchmark does) — moves the queue into JS memory instead of removing it.
- **Polling output on a timer** — adds latency to interactive typing and still needs a buffer bound.

## Consequences

Interactive latency is unaffected (small writes are far below the watermark), while floods are bounded in both processes. Flow control logic is tested in core with a fake PTY, without mongosh.
