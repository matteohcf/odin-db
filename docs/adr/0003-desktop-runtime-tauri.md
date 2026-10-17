# 0003. Desktop runtime: Tauri 2

- Status: Accepted
- Date: 2026-10-17

## Context

We need a cross-platform desktop runtime for a data-heavy app: virtualized grids with large result sets, a code editor, an embedded terminal.

## Decision

**Tauri 2** with a Rust backend and a React + TypeScript + Vite frontend.

Reasons: domain logic lives in a Rust crate that is testable without any UI; low memory footprint; small installers; capability-based permission model; official MongoDB Rust driver.

### Known risk and mitigation

Tauri uses the system webview: WebView2 (Windows), WKWebView (macOS), **WebKitGTK (Linux)**, which is noticeably weaker for heavy rendering. **Milestone 0 is a go/no-go spike**: a virtualized grid with 100k documents, CodeMirror 6 and xterm.js, measured on all three platforms against explicit budgets (scroll at 60 fps on reference hardware, memory ceiling, input latency). If Linux fails the budget with no viable mitigation, this ADR is revisited before product code is written.

## Alternatives considered

- **Electron + Node driver** — consistent Chromium everywhere and direct access to the mongodb-js ecosystem (Compass, embeddable mongosh). Rejected: higher memory and installer size, and business logic would live in Node with a weaker separation between core and UI. Remains the fallback if Milestone 0 fails.
- **Native UI (Qt, Slint, egui)** — far slower UI iteration, no reuse of the mature web component ecosystem (TanStack Table, CodeMirror, xterm.js).

## Consequences

Each webview needs testing (CI E2E on Linux and Windows, manual on macOS). Web APIs must be checked for WebKit support. Heavy rendering paths must stay virtualized.
