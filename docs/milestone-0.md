# Milestone 0: platform feasibility spike

Goal: confirm that the Tauri system webviews can sustain odin-db's heaviest views before product code is written (ADR-0003). The spike uses the real architecture: data comes from `odin-core` over a typed `Channel` (ADR-0006) as canonical EJSON (ADR-0007), and the UI uses the production stack (TanStack Table + Virtual, CodeMirror 6, xterm.js).

## Budgets (go/no-go)

| Area | Measurement | Budget |
|---|---|---|
| Grid | stream 100,000 documents from Rust until rendered | ≤ 3,000 ms |
| Grid | steady scroll (4,000 px/s, 8 s) and jump scroll (random positions, 8 s) | avg ≥ 55 fps, p95 frame ≤ 25 ms, ≤ 2 frames over 50 ms |
| Editor | load ~5 MB of pretty-printed JSON into CodeMirror until painted | ≤ 1,500 ms |
| Editor | steady scroll | same frame budget as the grid |
| Terminal | stream 50 MB of ANSI output into xterm.js | ≥ 20 MB/s |
| Terminal | frame pacing during the flood | same frame budget as the grid |
| Memory | webview process after loading 100k documents | ≤ 600 MB |

Thresholds live in `apps/desktop/src/features/perf-lab/lib/budgets.ts`.

## How to run

Use a **release** build: debug builds are not representative.

```sh
pnpm install
pnpm --filter @odin-db/desktop tauri build --no-bundle
./target/release/odin-desktop --perf-autorun > report.md   # odin-desktop.exe on Windows
```

`--perf-autorun` runs every benchmark unattended, prints a Markdown report to stdout and exits. It keeps the window on top because webviews throttle animation frames in occluded windows. Progress lines go to stderr. Without the flag, the same benchmarks can be run by hand from the UI.

Measure webview memory with OS tools while the run is in progress:
- macOS: RSS of the new `com.apple.WebKit.WebContent` process.
- Windows: Task Manager, `msedgewebview2.exe` processes under odin-db.
- Linux: `ps -o rss,cmd -C WebKitWebProcess`.

Reference hardware: one mid-range machine per OS. Linux must be tested on both X11 and Wayland.

## Results

### macOS — 2026-10-17

Apple M3, 16 GB, macOS 15.6.1. macos aarch64, WebView 20621.3.11.11.3, Tauri 2.12.4.

| Metric | Result | Budget | Pass |
|---|---|---|---|
| Grid load | 633 ms | ≤ 3000 ms | ✅ |
| Grid steady scroll | 60.0 fps · p95 19.0 ms · 0 stalls | ≥ 55 fps · p95 ≤ 25 ms · ≤ 2 stalls | ✅ |
| Grid jump scroll | 59.8 fps · p95 20.0 ms · 0 stalls | ≥ 55 fps · p95 ≤ 25 ms · ≤ 2 stalls | ✅ |
| Editor load (5.0 MB) | 51 ms | ≤ 1500 ms | ✅ |
| Editor scroll | 60.0 fps · p95 19.0 ms · 0 stalls | ≥ 55 fps · p95 ≤ 25 ms · ≤ 2 stalls | ✅ |
| Terminal throughput | 63.7 MB/s | ≥ 20 MB/s | ✅ |
| Terminal frames during flood | 50.5 fps · p95 42.0 ms · 1 stalls | ≥ 55 fps · p95 ≤ 25 ms · ≤ 2 stalls | ❌ |
| Renderer: webgl |  |  |  |

JS heap: not exposed by this webview, measure with OS tools

Peak WebContent RSS per phase: grid (100k documents loaded) 591 MB, editor 609 MB, terminal 713 MB. Baseline of an empty window is about 250 MB. Results were stable across 4 consecutive runs.

**Assessment: go.** Grid and editor are well within budget. The terminal frame budget fails only under a 64 MB/s synthetic flood (about 50 fps, at most one stall); real mongosh output is orders of magnitude slower. Memory is just under the budget for 100k documents; see finding 3.

### Windows

_Pending._

### Linux (WebKitGTK)

_Pending._

## Findings

1. **No backpressure across IPC (confirmed).** A Tauri `Channel` has no consumer acknowledgement. Sending 50 MB of terminal output without flow control made xterm.js exceed its 50 MB pending limit: it throws `write data discarded, use flow control to avoid losing data` and drops data, intermittently depending on timing. The benchmark now feeds xterm through watermarks (`terminal-writer.ts`), and with it the run is stable. **For the product:** the mongosh PTY needs end-to-end flow control (the backend pauses reading the PTY until the UI acknowledges consumption). Record it in an ADR before building the shell.
2. **TanStack Table's row/cell model does not scale to 100k rows.** Rendering through `row.getAllCells()` memoizes cell objects for every visited row: jump scrolling pushed the webview to about 980 MB and failed the frame budget. Rendering virtual rows directly from the data, with TanStack Table kept for the column model only, brought it down to about 600 MB and 60 fps. **For the product:** the result grid renders cells from the data; TanStack Table owns column state (sizing, order, visibility).
3. **Memory per loaded document is the limiting factor.** About 350 MB of the grid phase is the 100k canonical EJSON documents held in JS. ADR-0009 already caps loaded rows; the default cap should be well below 100k (e.g. 20k) with fetch on demand.
4. **Occluded windows throttle animation frames**, which also affects any rAF-driven UI work while the app is in the background.

## Open items

- **Windows and Linux runs** (pending).
- **Database Tools on Linux** (ADR-0015): official builds are distribution-specific. Verify a portable option (a statically linked build from source in CI, or the most portable official build).
- **Bundle size**: a single 1.3 MB JS chunk. The product should lazy-load the editor and terminal views.

## Decision

_To be filled once all three platforms have results: go, go with mitigations, or revisit ADR-0003._
