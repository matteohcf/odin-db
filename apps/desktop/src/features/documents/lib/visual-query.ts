/** A filter built from rows of field, operator and value (the visual query builder). */
export const OPERATORS = [
  "eq",
  "ne",
  "gt",
  "gte",
  "lt",
  "lte",
  "in",
  "nin",
  "contains",
  "startsWith",
  "exists",
  "missing",
] as const;
export type Operator = (typeof OPERATORS)[number];
export type Combinator = "and" | "or";

export interface Condition {
  field: string;
  operator: Operator;
  /** As typed; `in` and `nin` take comma-separated values. */
  value: string;
}

/** Operators that need no value. */
export const takesValue = (operator: Operator) => operator !== "exists" && operator !== "missing";

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const keyOf = (field: string) => (IDENTIFIER.test(field) ? field : JSON.stringify(field));
const NUMBER = /^-?\d+(\.\d+)?(e[+-]?\d+)?$/i;

/**
 * The value as mongosh syntax, typed after what the field holds in the
 * sample: `42` for numbers, `ObjectId("…")` for ids, `ISODate("…")` for
 * dates, `true`/`false` for booleans, otherwise a string.
 */
export function valueLiteral(raw: string, types: readonly string[]): string {
  const text = raw.trim();
  if (text === "null") return "null";
  if (types.includes("objectId") && /^[0-9a-f]{24}$/i.test(text)) return `ObjectId("${text}")`;
  if (types.includes("decimal") && NUMBER.test(text)) return `Decimal128(${JSON.stringify(text)})`;
  if (
    types.some((type) => type === "int" || type === "long" || type === "double") &&
    NUMBER.test(text)
  ) {
    return text;
  }
  if (types.includes("bool") && (text === "true" || text === "false")) return text;
  if (types.includes("date")) {
    const date = new Date(text);
    if (text !== "" && !Number.isNaN(date.getTime())) return `ISODate("${date.toISOString()}")`;
  }
  return JSON.stringify(raw);
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function condition({ operator, value }: Condition, types: readonly string[]): string {
  const literal = () => valueLiteral(value, types);
  const list = () =>
    `[${value
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item !== "")
      .map((item) => valueLiteral(item, types))
      .join(", ")}]`;
  switch (operator) {
    case "eq":
      return literal();
    case "ne":
    case "gt":
    case "gte":
    case "lt":
    case "lte":
      return `{ $${operator}: ${literal()} }`;
    case "in":
    case "nin":
      return `{ $${operator}: ${list()} }`;
    case "contains":
      return `{ $regex: ${JSON.stringify(escapeRegex(value))}, $options: "i" }`;
    case "startsWith":
      return `{ $regex: ${JSON.stringify(`^${escapeRegex(value)}`)} }`;
    case "exists":
      return "{ $exists: true }";
    case "missing":
      return "{ $exists: false }";
  }
}

/** Complete rows only: a field, and a value when the operator needs one. */
const isComplete = (row: Condition) =>
  row.field.trim() !== "" && (!takesValue(row.operator) || row.value.trim() !== "");

/** The filter as mongosh syntax; `""` when no row is complete. */
export function buildFilter(
  rows: readonly Condition[],
  combinator: Combinator,
  typesOf: (field: string) => readonly string[],
): string {
  const parts = rows.filter(isComplete).map((row) => ({
    key: keyOf(row.field.trim()),
    body: condition(row, typesOf(row.field.trim())),
  }));
  if (parts.length === 0) return "";
  const single = (part: { key: string; body: string }) => `{ ${part.key}: ${part.body} }`;
  if (parts.length === 1 && parts[0]) return single(parts[0]);
  if (combinator === "or") return `{ $or: [${parts.map(single).join(", ")}] }`;
  // One document while every field differs; a repeated field needs $and.
  const distinct = new Set(parts.map((part) => part.key)).size === parts.length;
  return distinct
    ? `{ ${parts.map((part) => `${part.key}: ${part.body}`).join(", ")} }`
    : `{ $and: [${parts.map(single).join(", ")}] }`;
}
