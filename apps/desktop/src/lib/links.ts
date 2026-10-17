import type { JsonValue } from "@odin-db/bindings";

/** A web or mail link stored as a string, which the app can open; the backend checks again. */
export function linkOf(value: JsonValue | undefined): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return /^(https?:\/\/|mailto:)\S+$/i.test(text) ? text : null;
}
