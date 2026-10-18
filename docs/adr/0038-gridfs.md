# 0038. GridFS files

- Status: Accepted
- Date: 2026-10-18

## Context

GridFS buckets store files as a `<bucket>.files` collection of descriptions and a
`<bucket>.chunks` collection of bytes. Browsing the descriptions already worked as an
ordinary collection, but files could not be saved to disk or added.

## Decision

- A collection named `<bucket>.files` is treated as a GridFS bucket: its rows get
  "Download file…" and its toolbar "Upload file". There is no separate view.
- `gridfs::download` and `gridfs::upload` in core use the driver's bucket API.
  Downloads write a `.partial` file renamed at the end, like exports; uploads check
  read-only before the file dialog opens and again in core.
- File dialogs open from Rust (`download_gridfs_file`, `upload_gridfs_file`); the
  webview never sends a path, only the suggested file name for the save dialog.
- tokio-util's `compat` feature bridges the driver's futures-io streams to tokio files.

## Alternatives considered

- **A dedicated GridFS browser tab** — more to build and learn; the collection view
  already lists, filters and sorts the descriptions.
- **Reading chunks with ordinary queries** — reimplements what the driver does and
  gets ordering and lengths wrong on edge cases.

## Consequences

- Transfers are not yet registered as long operations: quitting during a large
  download does not wait for it, and there is no progress bar. Revisit if large
  files become common.
