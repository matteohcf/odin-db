# Architecture Decision Records

Format: `template.md`. Accepted ADRs are immutable; supersede them with a new ADR.

| # | Title | Status |
|---|---|---|
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions | Accepted |
| [0002](0002-license.md) | License: MIT OR Apache-2.0 | Accepted |
| [0003](0003-desktop-runtime-tauri.md) | Desktop runtime: Tauri 2 | Accepted |
| [0004](0004-monorepo-layout.md) | Monorepo layout and boundaries | Accepted |
| [0005](0005-generated-bindings.md) | Rust as source of truth, generated TS bindings | Accepted |
| [0006](0006-ipc-contract.md) | IPC contract: commands, channels, events | Accepted |
| [0007](0007-bson-representation.md) | BSON over IPC: canonical Extended JSON | Accepted |
| [0008](0008-connection-management.md) | Connection management | Accepted |
| [0009](0009-result-pagination.md) | Result pagination via server-side cursors | Accepted, transport superseded by 0025 |
| [0010](0010-frontend-state.md) | Frontend state and feature structure | Accepted |
| [0011](0011-ui-stack.md) | UI component stack | Accepted |
| [0012](0012-query-editor.md) | Query editor syntax and aggregation builder | Accepted |
| [0013](0013-integrated-shell.md) | Integrated shell: hybrid model | Accepted |
| [0014](0014-mongosh-distribution.md) | mongosh distribution: detect or download | Accepted |
| [0015](0015-database-tools-sidecars.md) | mongodump/mongorestore as sidecars | Accepted, sourcing superseded by [0033](0033-database-tools-from-source.md) |
| [0016](0016-local-persistence.md) | Local persistence: SQLite and OS keyring | Accepted |
| [0017](0017-security-model.md) | Security model | Accepted |
| [0018](0018-authentication-scope.md) | Authentication mechanisms scope | Accepted |
| [0019](0019-import-export.md) | Import/export streaming | Accepted |
| [0020](0020-testing-strategy.md) | Testing strategy | Accepted |
| [0021](0021-code-quality-tooling.md) | Code quality tooling and conventions | Accepted |
| [0022](0022-ci-release-updates.md) | CI, releases, updates, code signing | Accepted |
| [0023](0023-logging-no-telemetry.md) | Logging, diagnostics, no telemetry | Accepted |
| [0024](0024-ux-baseline-i18n.md) | UX baseline and i18n | Accepted |
| [0025](0025-pull-based-result-paging.md) | Pull-based result paging | Accepted |
| [0026](0026-result-grid-rendering.md) | Result grid rendering | Accepted |
| [0027](0027-ui-development-harness.md) | UI development harness | Accepted |
| [0028](0028-aggregation-builder.md) | Aggregation builder | Accepted |
| [0029](0029-database-tools-resolution.md) | Database Tools resolution and process safety | Accepted |
| [0030](0030-shell-flow-control.md) | Shell sessions and flow control | Accepted |
| [0031](0031-query-bar-assistance.md) | Query bar assistance | Accepted |
| [0032](0032-aggregation-stage-assistance.md) | Aggregation stage assistance | Accepted |
| [0033](0033-database-tools-from-source.md) | Database Tools built from source | Accepted |
| [0034](0034-backup-history-and-schedules.md) | Backup history and schedules | Accepted |
| [0035](0035-settings-and-languages.md) | Settings and languages | Accepted |
| [0036](0036-ssh-tunnels.md) | SSH tunnels | Accepted |
| [0037](0037-large-deployments.md) | Large deployments | Accepted |
| [0038](0038-gridfs.md) | GridFS files | Accepted |
| [0039](0039-automatic-updates.md) | Automatic updates | Accepted |
| [0040](0040-ai-query-assistant.md) | AI query assistant | Accepted |
| [0041](0041-collection-compare.md) | Collection compare | Accepted |
| [0042](0042-query-profiler.md) | Query profiler | Accepted |
| [0043](0043-database-diagram.md) | Database diagram | Partly superseded by 0060 |
| [0044](0044-index-advisor.md) | Index advisor | Accepted |
| [0045](0045-schema-compare.md) | Schema compare | Accepted |
| [0046](0046-live-changes.md) | Live changes | Accepted |
| [0047](0047-diagram-annotations.md) | Diagram annotations | Accepted |
| [0048](0048-quick-charts.md) | Quick charts of results | Accepted |
| [0049](0049-results-map.md) | Results on a map | Accepted |
| [0050](0050-customizable-shortcuts.md) | Customizable shortcuts | Accepted |
| [0051](0051-file-picking-and-dropping.md) | Picking and dropping files | Accepted |
| [0052](0052-query-options.md) | Collation, hint and time limit for queries | Accepted |
| [0053](0053-collection-types-and-views.md) | Collection types and views | Accepted |
| [0054](0054-field-changes.md) | Renaming, converting and removing a field across documents | Accepted |
| [0055](0055-value-search.md) | Searching values across collections | Accepted |
| [0056](0056-undo-bulk-updates.md) | Undoing bulk updates and field changes | Accepted |
| [0057](0057-custom-roles.md) | Custom roles | Accepted |
| [0058](0058-connection-manager.md) | Connection manager | Partly superseded by 0059 |
| [0059](0059-sidebar-lists-every-connection.md) | The sidebar lists every connection | Accepted |
| [0060](0060-gentle-diagram-scans.md) | Gentle, saved diagram scans | Accepted |
