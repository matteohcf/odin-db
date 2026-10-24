# 0046. Live changes

- Status: Accepted
- Date: 2026-10-24

## Context

Debugging an application often means watching what it writes. Neither Compass nor Studio 3T
shows a collection's changes as they happen; users tail logs or poll with queries.

## Decision

- `changes::watch` opens a change stream on a collection (`fullDocument: updateLookup`) and sends
  each insert, update, replace, delete, drop, rename or invalidate as a `ChangeEvent`: the
  operation, the server's wall time, the document key, the document after the change, and what an
  update set and removed. An `invalidate` (the collection was dropped or renamed) ends the feed.
- The feed is the one stream that is not pull-based (ADR-0025): changes arrive when the server
  makes them. It is lossy instead: when the UI falls behind, events are dropped and counted
  (`ChangeFeed::Skipped`), never queued without bound. The UI batches renders per frame and keeps
  the newest 500.
- It is a registered, cancellable operation, but **passive**
  (`OperationRegistry::start_passive`): quitting cancels it without asking, since a live view is
  open-ended by nature.
- Standalone servers cannot open change streams; the error says so plainly.
- The UI is a "Live" view of the collection tab with pause, clear and filters by operation; a
  change opens to its document.

## Alternatives considered

- **Polling with queries** — misses deletes and intermediate states, and loads the server.
- **Tailing the oplog** — needs privileges on `local` and does not work on Atlas shared tiers.

## Consequences

- Watching needs the `changeStream` and `find` actions on the collection, and a replica set or
  sharded cluster.
