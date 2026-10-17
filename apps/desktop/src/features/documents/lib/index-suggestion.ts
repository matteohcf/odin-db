import type { EJsonDocument } from "@odin-db/bindings";
import { isJsonObject } from "@/lib/ejson-display";

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
/** Operators that match ranges rather than single values. */
const RANGE_OPERATORS = new Set(["$gt", "$gte", "$lt", "$lte", "$ne", "$nin", "$regex", "$exists"]);

function isRange(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.keys(value).some((key) => RANGE_OPERATORS.has(key));
}

function direction(value: unknown): 1 | -1 {
  const number =
    typeof value === "object" && value !== null ? Number(Object.values(value)[0]) : Number(value);
  return number < 0 ? -1 : 1;
}

/**
 * Index keys for a find, following MongoDB's ESR guideline: fields matched by
 * equality first, then the sort, then fields matched by range. `null` when the
 * query names no field that an index could serve.
 */
export function suggestIndexKeys(filter: EJsonDocument, sort: EJsonDocument | null): string | null {
  const keys = new Map<string, 1 | -1>();
  const conditions = Object.entries(isJsonObject(filter) ? filter : {}).filter(
    ([field]) => !field.startsWith("$"),
  );
  for (const [field, value] of conditions) if (!isRange(value)) keys.set(field, 1);
  for (const [field, value] of Object.entries(isJsonObject(sort) ? sort : {})) {
    if (!keys.has(field)) keys.set(field, direction(value));
  }
  for (const [field, value] of conditions)
    if (isRange(value) && !keys.has(field)) keys.set(field, 1);
  if (keys.size === 0) return null;
  const body = [...keys]
    .map(([field, dir]) => `${IDENTIFIER.test(field) ? field : JSON.stringify(field)}: ${dir}`)
    .join(", ");
  return `{ ${body} }`;
}
