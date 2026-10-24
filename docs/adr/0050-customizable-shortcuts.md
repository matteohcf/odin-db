# 0050. Customizable shortcuts

- Status: Accepted
- Date: 2026-10-25

## Context

Shortcuts were fixed in `lib/shortcuts.ts`. Some collide with system or keyboard-layout shortcuts,
and people coming from other tools expect their own keys.

## Decision

- Every shortcut in `SHORTCUTS` (global) and `EDIT_SHORTCUTS` (handled by the focused element)
  can be changed, removed and reset. The defaults stay in code; the user's changes are one
  setting, `keybindings` in `useSettings` (ADR-0035): a shortcut per changed id, `null` for none.
- `lib/keybindings.ts` resolves the shortcut in effect (`resolve`, `keybinding`), finds conflicts
  and turns a key press into a shortcut (`fromKeyEvent`). Handlers read the shortcut at key-press
  time, so a change applies at once, including in open editors (`submitOnKeybinding` for
  CodeMirror). Labels use `useKeybindingLabel`, which re-renders on change.
- A recorded shortcut needs Cmd/Ctrl (or a function key) and cannot use Option/Alt, which changes
  the character typed. Keys already bound elsewhere move only after confirmation, and the other
  shortcut is left without keys rather than sharing them.
- Navigation and in-place editing keys (arrows, Enter, Esc, Tab, F2…) stay fixed and are listed as
  built in.
- The settings page edits them with reusable pieces: `ShortcutRecorder`, `KeybindingRow`,
  `ShortcutsList` (also the read-only overview on Mod+/).

## Consequences

- A new shortcut is added to `SHORTCUTS` or `EDIT_SHORTCUTS`, to a group in `KEYBINDING_GROUPS`,
  and named in `common.shortcuts.actions`.
