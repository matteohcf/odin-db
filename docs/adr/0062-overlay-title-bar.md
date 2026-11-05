# 0062. Overlay title bar on macOS

- Status: Accepted
- Date: 2026-11-05

## Context

The native macOS title bar is a separate grey strip above the app that only holds the
traffic lights and a title. Most macOS apps draw their own top row instead, with the
traffic lights inside it. Windows and Linux have no equivalent convention: an undecorated
window there loses snap layouts, native resize borders and the window manager's own
controls, which differ per desktop.

## Decision

- macOS only: `src-tauri/tauri.macos.conf.json` replaces the main window with
  `titleBarStyle: "Overlay"`, `hiddenTitle: true` and `trafficLightPosition` (x 14, y 17),
  which centres the lights in a 36 px row (tao grows the buttons' container by `y`, so it
  is not their distance from the top). Windows and Linux keep native decorations.
- `useWindowChrome` (`src/app`) says whether the title bar is overlaid
  (`hasOverlayTitleBar`, `src/lib/window-chrome.ts`): macOS, in the app, not fullscreen
  (fullscreen hides the lights; it is read again on every resize, which ends both
  transitions). It also sets the native window theme from the app theme, so a native
  title bar on Windows and Linux matches it.
- With an overlaid title bar, `TitleBarRow` (`src/app`) is an empty 36 px row, level with
  the tab bar: at the top of the sidebar it holds the lights, and above the welcome page
  it gives the main area something to move the window by. It carries no name or logo:
  the window already is odin-db.
- Window dragging uses `data-tauri-drag-region="deep"` on `TitleBarRow` and on the tab
  bar, on every platform. Tauri's drag script ignores presses on buttons, tabs and other
  interactive elements, so only empty space moves the window; double-click zooms.
- The browser preview shows the macOS layout with `?titlebar=overlay`, for review and
  `e2e/titlebar.mjs`.

## Alternatives considered

- **Undecorated window with drawn controls on every platform** — loses Windows snap
  layouts and native resizing, and the controls would look foreign on most Linux desktops.
- **Traffic lights inside the sidebar's Connections header** — at the narrowest sidebar
  the title would be cut to a few letters next to five buttons.

## Consequences

- Anything new at the top of the window must leave the lights' corner free on macOS.
- The main window's options now live in two config files; `tauri.macos.conf.json` repeats
  the whole window entry, because platform config replaces arrays rather than merging them.
