import type { JsonValue } from "@odin-db/bindings";
import { EJSON } from "bson";
import { toShellSyntax } from "./shell-syntax";

export const COPY_FORMATS = ["shell", "json", "relaxed", "canonical"] as const;
export type CopyFormat = (typeof COPY_FORMATS)[number];

/**
 * Plain JSON for code and tests: ids as hex strings, dates as ISO strings,
 * 64-bit and decimal numbers as strings so no digit is lost.
 */
function plain(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(plain);
  if (value instanceof Date) return value.toISOString();
  const bsontype = (value as { _bsontype?: string })._bsontype;
  switch (bsontype) {
    case "ObjectId":
    case "Decimal128":
    case "Long":
      return value.toString();
    case "Double":
    case "Int32":
      return (value as { valueOf(): number }).valueOf();
    case "Binary":
      return (value as { toString(encoding: string): string }).toString("base64");
    case "BSONRegExp": {
      const regex = value as { pattern: string; options: string };
      return `/${regex.pattern}/${regex.options}`;
    }
    case undefined:
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plain(item)]));
    default:
      return String(value);
  }
}

/** A canonical EJSON value, as text in the chosen format. */
export function formatValue(value: JsonValue, format: CopyFormat): string {
  switch (format) {
    case "shell":
      return toShellSyntax(value);
    case "canonical":
      return JSON.stringify(value, null, 2);
    case "relaxed":
      return EJSON.stringify(
        EJSON.deserialize(value as object, { relaxed: false }),
        { relaxed: true },
        2,
      );
    case "json":
      return JSON.stringify(plain(EJSON.deserialize(value as object, { relaxed: false })), null, 2);
  }
}
