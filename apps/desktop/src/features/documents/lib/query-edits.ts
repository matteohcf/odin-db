import type { JsonValue } from "@odin-db/bindings";
import { toShellSyntax } from "@/lib/shell-syntax";

export interface FieldSort {
  field: string;
  direction: 1 | -1;
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

const keyOf = (field: string) => (IDENTIFIER.test(field) ? field : JSON.stringify(field));

const SORT_KEY = /^\s*(?:"([^"]+)"|'([^']+)'|([\w$.]+))\s*:\s*(-?1)\s*$/;

/**
 * The sort as a list of fields, when it is only `field: 1` or `field: -1`
 * pairs: `{ age: -1, name: 1 }`. Anything else (`$meta`, nested) is null.
 */
export function simpleSort(sort: string): FieldSort[] | null {
  const body = sort.trim().replace(/^\{/, "").replace(/\}$/, "").trim();
  if (body === "") return [];
  const fields: FieldSort[] = [];
  for (const part of body.split(",")) {
    const match = SORT_KEY.exec(part);
    const field = match?.[1] ?? match?.[2] ?? match?.[3];
    if (!match || !field) return null;
    fields.push({ field, direction: match[4] === "-1" ? -1 : 1 });
  }
  return fields;
}

export function sortText(sort: readonly FieldSort[]): string {
  if (sort.length === 0) return "";
  return `{ ${sort.map(({ field, direction }) => `${keyOf(field)}: ${direction}`).join(", ")} }`;
}

/**
 * The sort after clicking a column: ascending, descending, then off. A plain
 * click sorts by that column alone; with `append` (Shift) it adds or cycles
 * the column and keeps the others, like spreadsheets.
 */
export function nextSort(
  current: readonly FieldSort[],
  field: string,
  append: boolean,
): FieldSort[] {
  const existing = current.find((sort) => sort.field === field);
  const next: FieldSort | null = !existing
    ? { field, direction: 1 }
    : existing.direction === 1
      ? { field, direction: -1 }
      : null;
  if (!append) return next ? [next] : [];
  if (!existing) return [...current, { field, direction: 1 }];
  return next
    ? current.map((sort) => (sort.field === field ? next : sort))
    : current.filter((sort) => sort.field !== field);
}

/**
 * Adds `field: value` to a filter written in mongosh syntax, keeping what is
 * there. A filter that already constrains the field gets the new condition
 * through `$and`, so neither condition is lost.
 */
export function addFilterCondition(filter: string, field: string, value: string): string {
  const condition = `${keyOf(field)}: ${value}`;
  const text = filter.trim();
  if (text === "" || text === "{}") return `{ ${condition} }`;
  const body = text.startsWith("{") && text.endsWith("}") ? text.slice(1, -1).trim() : text;
  if (body === "") return `{ ${condition} }`;
  const mentioned = new RegExp(`(^|[{,\\s])["']?${escapeRegExp(field)}["']?\\s*:`).test(body);
  if (mentioned) return `{ $and: [{ ${body} }, { ${condition} }] }`;
  return `{ ${body}, ${condition} }`;
}

/**
 * The condition on a cell's value for `addFilterCondition`: equal, different,
 * greater or less. `undefined` means the document has no such field.
 */
export function valueCondition(
  value: JsonValue | undefined,
  how: "eq" | "ne" | "gt" | "lt" = "eq",
): string {
  const literal = value === undefined ? null : toShellSyntax(value, 0);
  return {
    eq: literal ?? "{ $exists: false }",
    ne: literal === null ? "{ $exists: true }" : `{ $ne: ${literal} }`,
    gt: `{ $gt: ${literal} }`,
    lt: `{ $lt: ${literal} }`,
  }[how];
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
