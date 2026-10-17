export interface FieldSort {
  field: string;
  direction: 1 | -1;
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

const keyOf = (field: string) => (IDENTIFIER.test(field) ? field : JSON.stringify(field));

/** The sort, when it orders by a single field: `{ age: -1 }`. */
export function singleFieldSort(sort: string): FieldSort | null {
  const match = /^\s*\{?\s*(?:"([^"]+)"|'([^']+)'|([\w$.]+))\s*:\s*(-?1)\s*\}?\s*$/.exec(sort);
  if (!match) return null;
  const field = match[1] ?? match[2] ?? match[3];
  if (!field) return null;
  return { field, direction: match[4] === "-1" ? -1 : 1 };
}

export function sortText(sort: FieldSort | null): string {
  return sort ? `{ ${keyOf(sort.field)}: ${sort.direction} }` : "";
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

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
