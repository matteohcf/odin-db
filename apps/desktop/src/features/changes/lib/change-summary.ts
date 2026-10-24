import type { ChangeEvent, JsonValue } from "@odin-db/bindings";
import { compactEJson, describeEJson, isJsonObject } from "@/lib/ejson-display";

export const OPERATIONS = ["insert", "update", "replace", "delete"] as const;
export type Operation = (typeof OPERATIONS)[number];

/** The changed document's `_id`, short enough for a row. */
export function idOf(change: ChangeEvent): string {
  const key = change.key;
  const id = isJsonObject(key) ? key._id : undefined;
  return id === undefined ? "" : compactEJson(id).text;
}

/** One line saying what changed: the fields an update set and removed, or the document. */
export function summarize(change: ChangeEvent): string {
  if (change.operation === "update") {
    const set = isJsonObject(change.updated) ? Object.entries(change.updated) : [];
    const parts = set.map(
      ([field, value]) => `${field}: ${describeEJson(value as JsonValue).text}`,
    );
    for (const field of change.removed) parts.push(`−${field}`);
    return parts.join(", ");
  }
  if (change.operation === "delete") return "";
  return change.document ? compactEJson(change.document).text : "";
}
