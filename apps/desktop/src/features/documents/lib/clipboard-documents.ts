import type { EJsonDocument, JsonValue } from "@odin-db/bindings";
import { isJsonObject } from "@/lib/ejson-display";
import { parseShellDocument } from "@/lib/shell-syntax";

/** A document, not a wrapped scalar such as `{ $numberInt: "1" }`. */
function isDocument(value: JsonValue | undefined): boolean {
  if (value === undefined || !isJsonObject(value)) return false;
  const keys = Object.keys(value);
  return !(keys.length === 1 && keys[0]?.startsWith("$"));
}

/**
 * Documents from pasted text: one document, an array of them, or one per line
 * (NDJSON), written as JSON, Extended JSON or mongosh syntax.
 */
export async function parseDocuments(text: string): Promise<EJsonDocument[]> {
  const trimmed = text.trim();
  if (trimmed === "") return [];
  const lines = trimmed.split(/\r?\n/).filter((line) => line.trim() !== "");
  // NDJSON: several lines, each a whole document.
  const ndjson =
    lines.length > 1 &&
    lines.every((line) => line.trim().startsWith("{") && line.trim().endsWith("}"));
  const source = ndjson ? `[${lines.join(",")}]` : trimmed;
  const wrapped = await parseShellDocument(`{ value: ${source} }`);
  const value = isJsonObject(wrapped) ? wrapped.value : undefined;
  const items = Array.isArray(value) ? value : [value];
  if (items.length === 0 || !items.every(isDocument)) {
    throw new Error("the clipboard does not hold documents");
  }
  return items as EJsonDocument[];
}
