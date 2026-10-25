import type { JsonValue } from "@odin-db/bindings";
import { isJsonObject, type JsonObject } from "@/lib/ejson-display";

/** The column holding the `_id` of the document a nested row comes from. */
export const PARENT_ID = "_id ↑";

/** A document or embedded document, not an Extended JSON value such as `{ $oid }`. */
export function isNested(value: JsonValue | undefined): boolean {
  if (Array.isArray(value)) return true;
  return isJsonObject(value) && !Object.keys(value).some((key) => key.startsWith("$"));
}

/**
 * The values at `path` in each row, as rows of their own: an array gives a row per element,
 * an embedded document one row; each keeps the `_id` of the document it comes from.
 */
export function stepInto(
  rows: readonly JsonObject[],
  path: readonly string[],
): { rows: JsonObject[]; columns: string[] } {
  let items: { id: JsonValue; value: JsonValue }[] = rows.map((row) => ({
    id: row._id ?? null,
    value: row,
  }));
  for (const field of path) {
    items = items.flatMap(({ id, value }) => {
      // A plain value or an inner array shows as the `value` column: stepping into it again
      // takes that same value.
      const inner =
        isJsonObject(value) && isNested(value)
          ? value[field]
          : field === "value"
            ? value
            : undefined;
      if (inner === undefined) return [];
      return Array.isArray(inner)
        ? inner.map((element) => ({ id, value: element }))
        : [{ id, value: inner }];
    });
  }
  const columns = [PARENT_ID];
  const seen = new Set(columns);
  const result = items.map(({ id, value }) => {
    const row: JsonObject =
      isJsonObject(value) && isNested(value)
        ? { [PARENT_ID]: id, ...value }
        : { [PARENT_ID]: id, value };
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
    return row;
  });
  return { rows: result, columns };
}
