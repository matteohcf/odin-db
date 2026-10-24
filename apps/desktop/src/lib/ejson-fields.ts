import type { FieldSummary, JsonValue } from "@odin-db/bindings";
import type { JsonObject } from "./ejson-display";

/** Canonical EJSON wrappers and the `$type` name of the value they hold. */
const WRAPPERS: Record<string, string> = {
  $oid: "objectId",
  $date: "date",
  $numberInt: "int",
  $numberLong: "long",
  $numberDouble: "double",
  $numberDecimal: "decimal",
  $binary: "binData",
  $uuid: "binData",
  $timestamp: "timestamp",
  $regularExpression: "regex",
  $minKey: "minKey",
  $maxKey: "maxKey",
  $symbol: "symbol",
  $code: "javascript",
};
const MAX_DEPTH = 6;
const MAX_VALUES = 12;
const MAX_VALUE_LENGTH = 64;

function typeOf(value: JsonValue): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "boolean") return "bool";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "double";
  const wrapper = Object.keys(value).find((key) => key in WRAPPERS);
  return wrapper ? (WRAPPERS[wrapper] as string) : "object";
}

/** A number or date as something to order by, with its kind; null for other values. */
function orderedOf(value: JsonValue): { kind: "number" | "date"; key: number } | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const type = typeOf(value);
  const inner = Object.values(value)[0];
  if (type === "int" || type === "long" || type === "double") {
    const key = Number(inner);
    return Number.isFinite(key) ? { kind: "number", key } : null;
  }
  if (type === "date") {
    const millis =
      inner !== null && typeof inner === "object" && !Array.isArray(inner)
        ? Number(inner.$numberLong)
        : Date.parse(String(inner));
    return Number.isNaN(millis) ? null : { kind: "date", key: millis };
  }
  return null;
}

type Extreme = { key: number; value: JsonValue };

/**
 * Field paths of canonical EJSON documents, summarized like core's
 * `schema::sample_fields`: dot notation, array items share the array's path.
 */
export function fieldPathsOf(documents: readonly JsonObject[]): FieldSummary[] {
  const stats = new Map<
    string,
    {
      count: number;
      types: Map<string, number>;
      strings: Map<string, number> | null;
      extremes: Partial<Record<"number" | "date", [Extreme, Extreme]>>;
    }
  >();

  for (const document of documents) {
    const seen = new Map<string, Set<string>>();
    const strings = new Map<string, Set<string>>();
    const ordered = new Map<string, JsonValue[]>();
    const visit = (value: JsonValue, path: string, depth: number) => {
      const type = typeOf(value);
      if (orderedOf(value)) ordered.set(path, [...(ordered.get(path) ?? []), value]);
      seen.set(path, (seen.get(path) ?? new Set()).add(type));
      // Strings inside an array count for the array's path: `{ tags: "x" }` matches them.
      for (const item of Array.isArray(value) ? value : [value]) {
        if (typeof item === "string" && item.length <= MAX_VALUE_LENGTH) {
          strings.set(path, (strings.get(path) ?? new Set()).add(item));
        }
      }
      if (depth + 1 >= MAX_DEPTH) return;
      const children = Array.isArray(value) ? value : type === "object" ? [value] : [];
      for (const child of children) {
        if (
          child !== null &&
          typeof child === "object" &&
          !Array.isArray(child) &&
          typeOf(child) === "object"
        ) {
          for (const [key, inner] of Object.entries(child))
            visit(inner, `${path}.${key}`, depth + 1);
        }
      }
    };
    for (const [key, value] of Object.entries(document)) visit(value, key, 0);

    for (const [path, types] of seen) {
      const entry = stats.get(path) ?? {
        count: 0,
        types: new Map(),
        strings: new Map(),
        extremes: {} as Partial<Record<"number" | "date", [Extreme, Extreme]>>,
      };
      for (const value of ordered.get(path) ?? []) {
        const found = orderedOf(value);
        if (!found) continue;
        const current = entry.extremes[found.kind];
        const extreme = { key: found.key, value };
        if (!current) entry.extremes[found.kind] = [extreme, extreme];
        else {
          if (found.key < current[0].key) current[0] = extreme;
          if (found.key > current[1].key) current[1] = extreme;
        }
      }
      entry.count += 1;
      for (const type of types) entry.types.set(type, (entry.types.get(type) ?? 0) + 1);
      if (entry.strings) {
        for (const value of strings.get(path) ?? []) {
          entry.strings.set(value, (entry.strings.get(value) ?? 0) + 1);
        }
        // Too many distinct values: not an enum-like field.
        if (entry.strings.size > MAX_VALUES) entry.strings = null;
      }
      stats.set(path, entry);
    }
  }

  const total = Math.max(documents.length, 1);
  return [...stats]
    .map(([path, { count, types, strings, extremes }]) => {
      const ranked = [...types].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      const main = ranked[0]?.[0];
      const kind =
        main === "int" || main === "long" || main === "double"
          ? "number"
          : main === "date"
            ? "date"
            : null;
      const extreme = kind ? extremes[kind] : undefined;
      return {
        range: extreme ? { min: extreme[0].value, max: extreme[1].value } : null,
        path,
        types: ranked.map(([type]) => type),
        typeShares: ranked.map(([, seen]) => seen / count),
        frequency: count / total,
        values: [...(strings ?? [])]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .map(([value]) => value),
      };
    })
    .sort((a, b) => b.frequency - a.frequency || a.path.localeCompare(b.path));
}
