import type { FieldSummary } from "@odin-db/bindings";

export type ExamplePrompt =
  | { kind: "newest"; field: string }
  | { kind: "greater"; field: string }
  | { kind: "contains"; field: string }
  | { kind: "missing"; field: string };

const NUMERIC = ["int", "long", "double", "decimal"];

/**
 * Up to three starting points built from field names and types only, so trying one never
 * sends a document value to the model. Top-level fields read best; `_id` is skipped.
 */
export function examplePrompts(fields: readonly FieldSummary[]): ExamplePrompt[] {
  const candidates = fields.filter((field) => field.path !== "_id" && !field.path.includes("."));
  const first = (types: readonly string[]) =>
    candidates.find((field) => types.includes(field.types[0] ?? ""))?.path;
  const date = first(["date"]);
  const number = first(NUMERIC);
  const text = first(["string"]);
  // A field missing from some documents is worth looking for.
  const sparse = candidates.find((field) => field.frequency !== null && field.frequency < 1)?.path;
  const examples: ExamplePrompt[] = [];
  if (date) examples.push({ kind: "newest", field: date });
  if (number) examples.push({ kind: "greater", field: number });
  if (text) examples.push({ kind: "contains", field: text });
  if (sparse && examples.length < 3) examples.push({ kind: "missing", field: sparse });
  return examples.slice(0, 3);
}
