# 0051. Picking and dropping files

- Status: Accepted
- Date: 2026-10-25

## Context

Imports and restores asked for a file through a bare "Choose file…" button. People expect to drag
a file from Finder or Explorer onto the app. The security model (ADR-0017) keeps paths out of the
webview's hands: dialogs open from Rust and the UI only holds opaque tokens.

## Decision

- Drops are handled natively, in Rust: the window's drag-and-drop event (`drops::on_drag_drop`)
  emits `FileDragChanged` while files are over the window and, on drop, keeps each path behind a
  token (as `remember_path` does for dialogs) and emits `FilesDropped` with tokens, names and
  whether each is a folder. The UI never sends a path back.
- A dropped token is turned into what a dialog would have returned by a command per use:
  `import_file_from_drop` (checks the extension, previews like `choose_import_file`),
  `import_folder_from_drop` (like `choose_import_folder`); a restore uses the token directly, and
  reading the archive reports what does not fit.
- The UI uses one component, `FilePicker` (`src/components`): a drop area with a browse button,
  highlighted while files are over the window, then the chosen file as a card with Change and
  Remove. `useFileDrop` gives a drop to the most recently mounted picker (the open dialog).

## Alternatives considered

- **HTML drag and drop in the webview** — gives `File` objects without paths, so large imports
  would have to be read in the webview and copied over IPC.
- **A registry "file upload" component** — built on `<input type="file">` and `File` objects, the
  same problem; the look is reproduced with the app's own primitives instead.

## Consequences

- A drop anywhere on the window goes to the open picker; without one it is ignored.
