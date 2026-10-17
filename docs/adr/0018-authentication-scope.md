# 0018. Authentication mechanisms scope

- Status: Accepted
- Date: 2026-10-17

## Context

Users connect to self-hosted servers, Atlas and corporate deployments. Each auth mechanism adds code, tests and platform dependencies.

## Decision

**V1**: standard URI and SRV (`mongodb+srv`), TLS (CA, client certificate, X.509 auth, allow-invalid toggles with an explicit warning), SCRAM-SHA-1/256, MONGODB-AWS, MONGODB-OIDC (as supported by the Rust driver), direct connection, replica set and read preference options. Profiles can be created from a pasted connection string; the password is extracted to the keyring.

**V1.1**: SSH tunnel (`russh`, pure Rust; password and key auth, agent support) inserted at the reserved transport step of the connection pipeline (ADR-0008). Kerberos (GSSAPI), which needs platform libraries and per-OS testing.

## Alternatives considered

- **SSH tunnel in V1** — high demand, but it is a self-contained feature with no impact on architecture thanks to the reserved pipeline step; deferring keeps V1 shippable.
- **Spawning system `ssh`** — depends on user setup, inconsistent on Windows.

## Consequences

The connection form is structured by mechanism, so new mechanisms add a section, not a rewrite.
