# 0036. SSH tunnels

- Status: Accepted
- Date: 2026-10-17

## Context

Production databases often accept connections only from a bastion host.
Studio 3T and Compass reach them through an SSH tunnel, and users expect the
same here. A tunnel handles credentials and decides which server we trust, so
it must be at least as careful as the rest of the connection code (ADR-0008,
ADR-0017).

## Decision

- **In-process SSH** with `russh` (pure Rust, Apache-2.0) using the `ring`
  backend already in the dependency tree. No `ssh` executable is required.
- **Profile settings**: an optional `ssh` section (host, port, user, and
  either password or private-key authentication) stored in SQLite with the
  profile. The private key is referenced by path, chosen through a Rust file
  dialog (the webview never sends paths). The SSH password or key passphrase
  goes to the OS keychain under its own entry, never to SQLite or the webview.
- **Host keys are pinned per profile**, trust on first use: the first
  connection fails with `UnknownHostKey` carrying the SHA-256 fingerprint; the
  UI shows it and the user confirms, which stores it. Later connections
  require the same key; a different one fails with `HostKeyChanged` and is
  never accepted silently. The pin is cleared when the SSH host changes.
- **Tunnel**: one local listener on `127.0.0.1` with a random port per open
  connection. Each accepted socket becomes a `direct-tcpip` channel to the
  MongoDB host. The connection string is rewritten to the local port with
  `directConnection=true`, since replica set members' addresses are not
  reachable through one forward. `mongodb+srv` cannot be tunneled and is
  rejected with a clear message. The tunnel lives in the `ConnectionHandle`
  and closes with it.
- **Tools** (mongodump, mongorestore, mongosh) receive the rewritten local
  connection string while the connection is open.

## Alternatives considered

- **Spawning the system `ssh -L`** — not installed on every Windows machine,
  harder to report errors from, and it would apply the user's own SSH config
  and host keys in ways the app cannot show.
- **Accepting any host key** — what many tools do by default; it makes the
  tunnel trivial to intercept.
- **Forwarding every replica set member** — complex and rarely what users
  set up; direct connection to one member covers the common case.

## Consequences

- SRV connection strings and multi-member replica sets through a tunnel are
  not supported; the UI says so.
- Integration tests run an SSH server container next to MongoDB on a private
  Docker network.
- RSA keys go through the `rsa` crate, which has an unfixed timing advisory
  (RUSTSEC-2023-0071, "Marvin"). It is accepted in `deny.toml`: the key signs
  one login per connection on the user's own machine. Ed25519 keys avoid it.
- Through a tunnel with TLS, the certificate is verified against its CA but
  not its host name (`tlsAllowInvalidHostnames`), which cannot match
  `127.0.0.1`.
