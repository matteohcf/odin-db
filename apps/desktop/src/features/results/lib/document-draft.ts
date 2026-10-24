import type { JsonValue } from "@odin-db/bindings";
import { describeEJson, type EJsonKind, isJsonObject } from "@/lib/ejson-display";
import { parseShellDocument, toShellSyntax } from "@/lib/shell-syntax";

/**
 * A document being edited in place: nested documents and arrays stay structured, every other
 * value is mongosh text (`"paid"`, `NumberInt(3)`, `ISODate("…")`) so no type changes on save.
 */
export type DraftField = {
  id: string;
  /** Ignored inside arrays, where the position is the key. */
  key: string;
} & ({ kind: "value"; text: string } | { kind: "document" | "array"; children: DraftField[] });

const newId = () => crypto.randomUUID();

export function toDraft(document: { [key: string]: JsonValue }): DraftField[] {
  return Object.entries(document).map(([key, value]) => fieldOf(key, value));
}

function fieldOf(key: string, value: JsonValue): DraftField {
  const { kind } = describeEJson(value);
  if (kind === "array" && Array.isArray(value)) {
    return { id: newId(), key, kind, children: value.map((item, i) => fieldOf(String(i), item)) };
  }
  if (kind === "document" && isJsonObject(value)) {
    return {
      id: newId(),
      key,
      kind,
      children: Object.entries(value).map(([name, item]) => fieldOf(name, item)),
    };
  }
  return { id: newId(), key, kind: "value", text: toShellSyntax(value, 0) };
}

/** A new, empty field to fill in. */
export const emptyField = (): DraftField & { kind: "value" } => ({
  id: newId(),
  key: "",
  kind: "value",
  text: '""',
});

/** The draft as one mongosh document, ready for `parseShellDocument`. */
export function draftToShell(fields: readonly DraftField[]): string {
  return writeFields(fields, "document");
}

function writeFields(fields: readonly DraftField[], kind: "document" | "array"): string {
  const parts = fields.map((field) => {
    const value =
      field.kind === "value"
        ? field.text.trim() || "null"
        : writeFields(field.children, field.kind);
    return kind === "array" ? value : `${JSON.stringify(field.key)}: ${value}`;
  });
  return kind === "array" ? `[${parts.join(", ")}]` : `{${parts.join(", ")}}`;
}

/** Applies `change` to the field with `id`, wherever it is nested; `null` removes it. */
export function updateField(
  fields: readonly DraftField[],
  id: string,
  change: (field: DraftField) => DraftField | null,
): DraftField[] {
  return fields.flatMap((field) => {
    if (field.id === id) {
      const next = change(field);
      return next ? [next] : [];
    }
    if (field.kind === "value") return [field];
    return [{ ...field, children: updateField(field.children, id, change) }];
  });
}

/** Inserts `field` after the field with `afterId`, or at the end of `parentId`'s children. */
export function insertField(
  fields: readonly DraftField[],
  field: DraftField,
  place: { afterId: string } | { parentId: string | null },
): DraftField[] {
  if ("parentId" in place && place.parentId === null) return [...fields, field];
  return fields.flatMap((current) => {
    if ("afterId" in place && current.id === place.afterId) return [current, field];
    if (current.kind === "value") return [current];
    const children =
      "parentId" in place && current.id === place.parentId
        ? [...current.children, field]
        : insertField(current.children, field, place);
    return [{ ...current, children }];
  });
}

export interface DraftProblem {
  id: string;
  message: string;
}

/** Empty or repeated names and values that are not valid mongosh. */
export async function checkDraft(fields: readonly DraftField[]): Promise<DraftProblem[]> {
  const problems: DraftProblem[] = [];
  const values: Promise<void>[] = [];
  const visit = (list: readonly DraftField[], inArray: boolean) => {
    const seen = new Set<string>();
    for (const field of list) {
      if (!inArray) {
        if (field.key.trim() === "") problems.push({ id: field.id, message: "name" });
        else if (seen.has(field.key)) problems.push({ id: field.id, message: "duplicate" });
        seen.add(field.key);
      }
      if (field.kind === "value") {
        values.push(
          parseShellDocument(`{ v: ${field.text.trim() || "null"}\n}`).then(
            () => undefined,
            (error: unknown) => {
              problems.push({
                id: field.id,
                message: error instanceof Error ? error.message : String(error),
              });
            },
          ),
        );
      } else {
        visit(field.children, field.kind === "array");
      }
    }
  };
  visit(fields, false);
  await Promise.all(values);
  return problems;
}

/** The BSON kind a mongosh value text spells, to color it while it is being edited. */
export function kindOfText(text: string): EJsonKind {
  const value = text.trim();
  if (value.startsWith('"') || value.startsWith("'")) return "string";
  if (/^ObjectId\(/.test(value)) return "objectId";
  if (/^(ISODate|new Date|Date)\(/.test(value)) return "date";
  if (value === "true" || value === "false") return "boolean";
  if (value === "null" || value === "") return "null";
  if (/^(-?[\d.]|NumberInt|NumberLong|Long|Double|Decimal128|Int32)/.test(value)) return "number";
  return "other";
}
