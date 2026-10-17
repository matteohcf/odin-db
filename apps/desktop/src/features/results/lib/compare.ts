import type { JsonValue } from "@odin-db/bindings";
import { describeEJson, type JsonObject } from "@/lib/ejson-display";

export interface FieldDifference {
  /** Dotted path, array indexes included: `items.0.sku`. */
  path: string;
  /** Display text of each side; `undefined` where the field is missing. */
  left: string | undefined;
  right: string | undefined;
  status: "same" | "changed" | "added" | "removed";
}

/**
 * Compares two documents field by field, down to their leaves. Values compare by their
 * typed text, so `5` and `Long("5")` differ like they do in MongoDB.
 */
export function compareDocuments(left: JsonObject, right: JsonObject): FieldDifference[] {
  const a = leaves(left);
  const b = leaves(right);
  const paths = [...new Set([...a.keys(), ...b.keys()])];
  return paths.map((path) => {
    const l = a.get(path);
    const r = b.get(path);
    const status =
      l === undefined ? "added" : r === undefined ? "removed" : l === r ? "same" : "changed";
    return { path, left: l, right: r, status };
  });
}

function leaves(document: JsonObject): Map<string, string> {
  const out = new Map<string, string>();
  const visit = (value: JsonValue, path: string) => {
    const { kind, text } = describeEJson(value);
    const children: [string, JsonValue][] =
      kind === "array" && Array.isArray(value)
        ? value.map((item, index) => [String(index), item])
        : kind === "document" &&
            value !== null &&
            typeof value === "object" &&
            !Array.isArray(value)
          ? Object.entries(value)
          : [];
    // Empty documents and arrays are values of their own.
    if (children.length === 0) out.set(path, text);
    for (const [key, child] of children) visit(child, path ? `${path}.${key}` : key);
  };
  visit(document, "");
  return out;
}
