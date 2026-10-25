# 0059. The sidebar lists every connection

- Status: Accepted
- Date: 2026-10-25
- Supersedes: the sidebar part of [ADR-0058](0058-connection-manager.md)

## Context

ADR-0058 moved saved connections to a dialog and kept only connected profiles in the
sidebar. In use, the sidebar stopped answering its first question, "what can I connect to,
and what is connected?": imported connections did not appear until opened one by one from
the dialog, and a disconnected profile vanished instead of showing that it was closed.
Compass, the reference for the sidebar (PRODUCT.md), lists every connection and marks the
open ones with a dot.

The same report showed a connection the backend no longer had (closed elsewhere, dropped by
the server) still shown as open, with "connection is not open" in place of its databases:
the UI's list of open connections was refreshed only by its own connect and disconnect.

## Decision

- **The sidebar tree lists every saved profile**, in its groups, as before ADR-0058. An open
  connection has a green dot and expands into its databases; clicking a closed one connects
  and expands it; disconnecting closes it and removes the dot, the row stays.
- **The connection manager stays** as a quick, searchable way to connect (Mod+O), without its
  own button in the sidebar header or a "no open connections" state that sends people to it.
- **A "not connected" error from any query or command refreshes the open connections**
  (`app/query-client.ts`, through the `connectionsKey` the connections feature exports), so a
  connection the backend lost shows as closed instead of as an error under a green dot.

## Alternatives considered

- **Keep ADR-0058 and add a "show all" switch** — two modes for one list; the simple one is
  the one people expect.
- **Remove the connection manager** — the sidebar and the command palette already connect;
  the dialog is kept because searching a long list of profiles by group is quicker there.

## Consequences

- People with dozens of profiles see them all again; folders, the filter and favorites keep
  the list manageable.
- UI checks connect by clicking the sidebar row (`e2e/lib/connect.mjs`).
