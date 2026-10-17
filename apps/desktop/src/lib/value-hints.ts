import type { JsonValue } from "@odin-db/bindings";
import { isJsonObject } from "./ejson-display";

/** When an ObjectId was generated: its first four bytes are a Unix timestamp. */
export function objectIdTime(hex: string): Date | null {
  if (!/^[0-9a-f]{24}$/i.test(hex)) return null;
  return new Date(Number.parseInt(hex.slice(0, 8), 16) * 1000);
}

/** The moment a value stands for, if any: a date, or an ObjectId's creation time. */
export function momentOf(value: JsonValue): { kind: "date" | "objectId"; date: Date } | null {
  if (!isJsonObject(value)) return null;
  if (typeof value.$oid === "string") {
    const date = objectIdTime(value.$oid);
    return date ? { kind: "objectId", date } : null;
  }
  const inner = value.$date;
  if (inner === undefined) return null;
  const millis = isJsonObject(inner) ? Number(inner.$numberLong) : Number(inner);
  return Number.isFinite(millis) ? { kind: "date", date: new Date(millis) } : null;
}
