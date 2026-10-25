import type { JsonValue } from "@odin-db/bindings";

export type JsonObject = { [key: string]: JsonValue };

export type EJsonKind =
  | "null"
  | "boolean"
  | "number"
  | "string"
  | "objectId"
  | "date"
  | "binary"
  | "document"
  | "array"
  | "other";

export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Renders canonical Extended JSON (ADR-0007) in mongosh-like syntax for display.
 * Numeric types stay distinguishable: Int32 `5`, Double `5.0`, Int64 `NumberLong("5")`.
 * Constructors match the editable syntax (`toShellSyntax`), so a value reads the same everywhere.
 */
export function describeEJson(value: JsonValue): { kind: EJsonKind; text: string } {
  if (value === null) return { kind: "null", text: "null" };
  if (typeof value === "boolean") return { kind: "boolean", text: String(value) };
  if (typeof value === "number") return { kind: "number", text: String(value) };
  if (typeof value === "string") return { kind: "string", text: JSON.stringify(value) };
  if (Array.isArray(value)) {
    return { kind: "array", text: `[${value.map((item) => describeEJson(item).text).join(", ")}]` };
  }
  return describeObject(value);
}

function describeObject(value: JsonObject): { kind: EJsonKind; text: string } {
  const keys = Object.keys(value);
  const [key] = keys;
  const inner = key === undefined ? undefined : value[key];

  if (keys.length === 1 && key?.startsWith("$")) {
    switch (key) {
      case "$oid":
        return { kind: "objectId", text: `ObjectId(${JSON.stringify(inner)})` };
      case "$numberInt":
        return { kind: "number", text: String(inner) };
      case "$numberDouble":
        return { kind: "number", text: formatDouble(String(inner)) };
      case "$numberLong":
        return { kind: "number", text: `NumberLong(${JSON.stringify(inner)})` };
      case "$numberDecimal":
        return { kind: "number", text: `Decimal128(${JSON.stringify(inner)})` };
      case "$date":
        return { kind: "date", text: formatDate(inner) };
      case "$binary":
        if (isJsonObject(inner)) {
          const subType = Number.parseInt(String(inner.subType), 16);
          return {
            kind: "binary",
            text: `BinData(${subType}, ${JSON.stringify(inner.base64)})`,
          };
        }
        break;
      case "$timestamp":
        if (isJsonObject(inner)) {
          return { kind: "other", text: `Timestamp({ t: ${inner.t}, i: ${inner.i} })` };
        }
        break;
      case "$regularExpression":
        if (isJsonObject(inner)) {
          return { kind: "other", text: `/${String(inner.pattern)}/${String(inner.options)}` };
        }
        break;
      case "$minKey":
        return { kind: "other", text: "MinKey()" };
      case "$maxKey":
        return { kind: "other", text: "MaxKey()" };
      case "$undefined":
        return { kind: "null", text: "undefined" };
      case "$code":
        return { kind: "other", text: `Code(${JSON.stringify(inner)})` };
      case "$symbol":
        return { kind: "string", text: JSON.stringify(inner) };
    }
  }

  const fields = keys.map((k) => {
    const field = value[k];
    return `${formatKey(k)}: ${field === undefined ? "undefined" : describeEJson(field).text}`;
  });
  return { kind: "document", text: fields.length === 0 ? "{}" : `{ ${fields.join(", ")} }` };
}

function formatDouble(raw: string): string {
  if (raw === "NaN" || raw === "Infinity" || raw === "-Infinity") return raw;
  return /[.eE]/.test(raw) ? raw : `${raw}.0`;
}

function formatDate(inner: JsonValue | undefined): string {
  const millis = isJsonObject(inner) ? Number(inner.$numberLong) : Number.NaN;
  const date = new Date(millis);
  // Dates outside the JS range are still valid BSON; show the raw milliseconds.
  if (Number.isNaN(date.getTime())) {
    return isJsonObject(inner)
      ? `Date(NumberLong(${JSON.stringify(inner.$numberLong)}))`
      : "Date(?)";
  }
  return `ISODate(${JSON.stringify(date.toISOString())})`;
}

function formatKey(key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
}

/**
 * Grid rendering: the bare value, since the column header and the color already
 * carry the type. Strings lose their quotes, ObjectIds and numbers their wrappers,
 * dates read as UTC timestamps. Anything else falls back to `describeEJson`.
 */
export function compactEJson(value: JsonValue): { kind: EJsonKind; text: string } {
  const described = describeEJson(value);
  if (typeof value === "string") return { kind: "string", text: value };
  if (!isJsonObject(value)) return described;

  const [key] = Object.keys(value);
  const inner = key === undefined ? undefined : value[key];
  switch (described.kind) {
    case "objectId":
      return { kind: "objectId", text: String(inner) };
    case "date": {
      const millis = isJsonObject(inner) ? Number(inner.$numberLong) : Number.NaN;
      const date = new Date(millis);
      return Number.isNaN(date.getTime())
        ? described
        : { kind: "date", text: date.toISOString().replace("T", " ").replace("Z", " UTC") };
    }
    case "number":
      return key === "$numberDouble" ? described : { kind: "number", text: String(inner) };
    default:
      return described;
  }
}

const BSON_TYPE_KINDS: Record<string, EJsonKind> = {
  double: "number",
  int: "number",
  long: "number",
  decimal: "number",
  string: "string",
  object: "document",
  array: "array",
  binData: "binary",
  objectId: "objectId",
  bool: "boolean",
  date: "date",
  timestamp: "date",
  null: "null",
  undefined: "null",
};

/** The display kind of a `$type` name (`"objectId"`, `"long"`), as sampled schemas report them. */
export function kindOfBsonType(type: string): EJsonKind {
  return BSON_TYPE_KINDS[type] ?? "other";
}
