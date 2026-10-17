import { parse } from "@mongodb-js/shell-bson-parser";
import type { EJsonDocument, JsonValue } from "@odin-db/bindings";
import { EJSON } from "bson";
import { isJsonObject, type JsonObject } from "./ejson-display";

/**
 * Editable mongosh syntax for canonical Extended JSON (ADR-0007, ADR-0012).
 *
 * Unlike the display format, this text must parse back to exactly the same BSON
 * types, so ambiguous numbers are written with explicit constructors:
 * a whole Double is `Double(5)` because `5` would parse as Int32.
 */
export function toShellSyntax(value: JsonValue, indent = 2): string {
  return write(value, indent, 0);
}

export class ShellSyntaxError extends Error {
  override name = "ShellSyntaxError";
}

/** Parses mongosh syntax into a canonical EJSON document. Empty input is `{}`. */
export async function parseShellDocument(text: string): Promise<EJsonDocument> {
  if (text.trim() === "") return {};
  let parsed: unknown;
  try {
    parsed = await parse(text, { mode: "strict" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // The parser echoes the whole input after the position; the editor already shows it.
    // It also parses `(\n<input>\n)`, so its line numbers are one past the user's.
    throw new ShellSyntaxError(
      message
        .replace(/\s+in \([\s\S]*\)$/, "")
        .replace(
          /\((\d+):(\d+)\)/,
          (_, line: string, column: string) => `(${Math.max(1, Number(line) - 1)}:${column})`,
        ),
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ShellSyntaxError("Expected a document like { field: value }");
  }
  // bson's serialize result is plain JSON, which is exactly what EJsonDocument describes.
  return EJSON.serialize(parsed, { relaxed: false }) as EJsonDocument;
}

function write(value: JsonValue, indent: number, depth: number): string {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return String(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return block(
      value.map((item) => write(item, indent, depth + 1)),
      "[",
      "]",
      indent,
      depth,
    );
  }
  return writeWrapper(value) ?? writeDocument(value, indent, depth);
}

function writeDocument(value: JsonObject, indent: number, depth: number): string {
  const fields = Object.entries(value).map(
    ([key, field]) => `${formatKey(key)}: ${write(field, indent, depth + 1)}`,
  );
  return block(fields, "{", "}", indent, depth);
}

function block(items: string[], open: string, close: string, indent: number, depth: number) {
  if (items.length === 0) return `${open}${close}`;
  if (indent === 0) return `${open} ${items.join(", ")} ${close}`;
  const pad = " ".repeat(indent * (depth + 1));
  const closePad = " ".repeat(indent * depth);
  return `${open}\n${items.map((item) => `${pad}${item}`).join(",\n")}\n${closePad}${close}`;
}

function writeWrapper(value: JsonObject): string | undefined {
  const keys = Object.keys(value);
  const [key] = keys;
  if (keys.length !== 1 || key === undefined || !key.startsWith("$")) return undefined;
  const inner = value[key];

  switch (key) {
    case "$oid":
      return `ObjectId(${JSON.stringify(inner)})`;
    case "$numberInt":
      return String(inner);
    case "$numberDouble":
      return writeDouble(String(inner));
    case "$numberLong":
      return `NumberLong(${JSON.stringify(inner)})`;
    case "$numberDecimal":
      return `Decimal128(${JSON.stringify(inner)})`;
    case "$date": {
      const millis = isJsonObject(inner) ? Number(inner.$numberLong) : Number.NaN;
      const date = new Date(millis);
      return Number.isNaN(date.getTime())
        ? undefined
        : `ISODate(${JSON.stringify(date.toISOString())})`;
    }
    case "$binary":
      return isJsonObject(inner)
        ? `BinData(${Number.parseInt(String(inner.subType), 16)}, ${JSON.stringify(inner.base64)})`
        : undefined;
    case "$timestamp":
      return isJsonObject(inner) ? `Timestamp({ t: ${inner.t}, i: ${inner.i} })` : undefined;
    case "$regularExpression":
      return isJsonObject(inner)
        ? `/${String(inner.pattern).replaceAll("/", "\\/")}/${String(inner.options)}`
        : undefined;
    case "$minKey":
      return "MinKey()";
    case "$maxKey":
      return "MaxKey()";
    case "$code":
      return `Code(${JSON.stringify(inner)})`;
    default:
      return undefined;
  }
}

function writeDouble(raw: string): string {
  if (raw === "NaN" || raw === "Infinity" || raw === "-Infinity") return raw;
  const number = Number(raw);
  // Whole numbers (and -0) would parse back as Int32 without the constructor.
  return Number.isInteger(number) ? `Double(${Object.is(number, -0) ? "-0" : raw})` : raw;
}

function formatKey(key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
}
