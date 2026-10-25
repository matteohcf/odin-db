# 0058. Connection manager

- Status: Accepted
- Date: 2026-10-25

## Context

The sidebar listed every saved connection, connected or not, with its databases and
collections below the open ones. People who keep dozens of profiles (one per
customer, environment and region) scrolled past folders of connections they were
not using to reach the one they were, and the tree mixed two jobs: choosing what to
connect to, and browsing what is connected.

## Decision

- **The sidebar tree shows connected profiles only**, still in their groups.
  `ConnectionExplorer` passes `buildTreeRows` the profiles that have a connection;
  disconnecting removes one from the tree.
- **Saved connections live in the connection manager**, a dialog
  (`ConnectionManager`) opened from the sidebar header, the sidebar's empty state,
  the welcome page and the `connectionManager` shortcut (Mod+O). It lists every
  profile in its group, searchable by group and connection name, with the same rows
  and menus as the tree (edit, duplicate, copy URI, export, delete; rename and
  ungroup on folders) plus new, import and export.
- **Clicking a profile connects it**, as clicking it in the tree did: the dialog
  closes and the connection opens expanded in the sidebar. Clicking one that is
  already connected closes the dialog and expands it there. A failure keeps the
  dialog open and shows a toast.
- The rows are built by the same `buildTreeRows` as the tree, with no connections
  listed, so filtering and grouping behave the same in both.

## Alternatives considered

- **A workspace tab of connections** — room for more detail per profile, but one
  more tab to manage, and choosing a connection is a moment, not a place.
- **A switch at the top of the sidebar (connected / all)** — no new surface, but the
  sidebar is still where the long list lives, which is what this removes.

## Consequences

- With nothing connected the sidebar shows an empty state that opens the manager;
  saved connections are one shortcut or one click away, not always visible.
- Group actions that only made sense for unconnected profiles (new connection in a
  group, rename, ungroup) are reachable from the manager's folders as well as the
  tree's.
- UI checks connect through the manager (`e2e/lib/connect.mjs`), not by clicking a
  sidebar row first.
