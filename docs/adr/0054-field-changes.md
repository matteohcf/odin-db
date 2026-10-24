# 0054. Renaming, converting and removing a field across documents

- Status: Accepted
- Date: 2026-10-25

## Context

Reshaping data is a routine chore: a field gets a better name, numbers were imported as strings,
an obsolete field should go. Studio 3T has Reschema for it; here it took a hand-written bulk
update, and a type conversion needs a pipeline update, which the bulk update dialog does not
take.

## Decision

- `documents::change_field(filter, field, FieldChange)`: `rename { to }` (`$rename`), `remove`
  (`$unset`) or `convert { to: ConvertTarget }` (a pipeline update with `$convert`, keeping the
  value on error or null). The filter is narrowed to documents that have the field, and for a
  conversion to those of another type, so `matched - modified` is the number of values that
  could not be converted, which the UI reports. `_id` is refused.
- The grid's column menu offers Rename field, Change type and Remove field on writable
  collections. `ChangeFieldDialog` applies to the query bar's filter, shows how many documents
  match, and, for every document of the collection, asks for its name like the bulk dialogs
  (`MatchingDocuments`, `ConfirmCollectionName` are shared with them).

## Alternatives considered

- **Prefilling the bulk update dialog** — no conversions without pipeline updates, no count of
  failed conversions, and the user still writes the operator.
- **A schema-wide reshape plan** (several changes at once) — more than people need for the common
  case; one field at a time keeps the dialog simple.

## Consequences

- Renamed fields move to the end of each document, as `$rename` does.
