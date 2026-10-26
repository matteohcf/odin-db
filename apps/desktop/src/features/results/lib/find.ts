import type { JsonValue } from "@odin-db/bindings";
import { describeEJson, isJsonObject, type JsonObject } from "@/lib/ejson-display";

/** One top-level field of one loaded document that contains the searched text. */
export interface FindMatch {
  row: number;
  field: string;
}

/** Past this many, counting stops: the bar says "N+" and moving still works through them. */
export const MAX_MATCHES = 10_000;

/**
 * Like a browser's Find in Page, over the loaded documents rather than the screen, which
 * renders only the rows in view. A field matches when its name or anything inside its value
 * (nested field names included) contains the text, ignoring case. Fields come in `fields`
 * order when given (the table's columns), otherwise in each document's own order.
 */
export function findMatches(
  rows: readonly JsonObject[],
  query: string,
  fields?: readonly string[],
): FindMatch[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const matches: FindMatch[] = [];
  for (const [row, document] of rows.entries()) {
    for (const field of fields ?? Object.keys(document)) {
      const value = document[field];
      if (value === undefined) continue;
      if (field.toLowerCase().includes(needle) || contains(value, needle)) {
        matches.push({ row, field });
        if (matches.length >= MAX_MATCHES) return matches;
      }
    }
  }
  return matches;
}

function contains(value: JsonValue, needle: string): boolean {
  const { kind, text } = describeEJson(value);
  if (kind === "array" && Array.isArray(value)) return value.some((item) => contains(item, needle));
  if (kind === "document" && isJsonObject(value)) {
    return Object.entries(value).some(
      ([key, item]) => key.toLowerCase().includes(needle) || contains(item, needle),
    );
  }
  // Strings as they are, not quoted and escaped; other values as the cells show them.
  return (typeof value === "string" ? value : text).toLowerCase().includes(needle);
}

/** Identifies a cell among the matches, for a quick lookup while rendering. */
export function matchKey(row: number, field: string): string {
  return `${row}\u0000${field}`;
}

/** The match after (or before) `current`, wrapping around like a browser. */
export function stepMatch(current: number, count: number, step: 1 | -1): number {
  if (count === 0) return -1;
  return (((current + step) % count) + count) % count;
}
