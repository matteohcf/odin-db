import { CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import type { FieldSummary } from "@odin-db/bindings";
import { describe, expect, it } from "vitest";
import { type QueryKind, queryCompletionSource } from "./query-completion";

const fields: FieldSummary[] = [
  { path: "_id", types: ["objectId"], frequency: 1, values: [] },
  { path: "name", types: ["string"], frequency: 1, values: [] },
  { path: "plan", types: ["string"], frequency: 1, values: ["free", "pro", "team"] },
  { path: "address.city", types: ["string"], frequency: 0.5, values: [] },
  { path: "items", types: ["array"], frequency: 0.4, values: [] },
  { path: "items.sku", types: ["string"], frequency: 0.4, values: [] },
];

/** `|` marks the cursor. */
function complete(text: string, kind: QueryKind = "filter", explicit = false) {
  const pos = text.indexOf("|");
  const state = EditorState.create({ doc: text.replace("|", "") });
  const source = queryCompletionSource({
    kind,
    fields: () => fields,
    describe: () => undefined,
    labels: { fields: "Fields", operators: "Operators", values: "Values" },
  });
  return source(new CompletionContext(state, pos, explicit)) as CompletionResult | null;
}

const labels = (result: CompletionResult | null) => result?.options.map((o) => o.label) ?? [];

describe("queryCompletionSource", () => {
  it("offers fields and logical operators for top-level keys", () => {
    const result = complete("{ |");
    expect(labels(result)).toEqual(expect.arrayContaining(["_id", "address.city", "$or"]));
    expect(labels(result)).not.toContain("$gt");
  });

  it("adds the colon only when missing", () => {
    const options = complete("{ add|")?.options ?? [];
    expect(typeof options.find((o) => o.label === "address.city")?.apply).toBe("function");
    const beforeColon = complete("{ na|: 1 }")?.options ?? [];
    expect(beforeColon.find((o) => o.label === "name")?.apply).toBe("name");
  });

  it("offers field operators inside a field's condition", () => {
    expect(labels(complete("{ name: { |"))).toEqual(expect.arrayContaining(["$gt", "$in"]));
    expect(labels(complete("{ name: { |"))).not.toContain("name");
  });

  it("offers fields relative to the array inside $elemMatch", () => {
    expect(labels(complete("{ items: { $elemMatch: { |"))).toContain("sku");
  });

  it("prefers the constructor matching the field's type", () => {
    const result = complete("{ _id: |", "filter", true);
    const objectId = result?.options.find((o) => o.label === "ObjectId");
    expect(objectId?.boost).toBe(50);
  });

  it("waits for a word before suggesting values while typing", () => {
    expect(complete("{ _id: |")).toBeNull();
    expect(labels(complete("{ _id: Obj|"))).toContain("ObjectId");
  });

  it("suggests directions for sort and inclusion for projection", () => {
    expect(labels(complete("{ name: |", "sort", true))).toEqual(["1", "-1"]);
    expect(labels(complete("{ name: |", "projection", true))).toEqual(["1", "0"]);
    expect(labels(complete("{ |", "sort"))).toContain("address.city");
    expect(labels(complete("{ |", "sort"))).not.toContain("$or");
  });

  it("offers $type names and $exists booleans", () => {
    expect(labels(complete("{ a: { $type: |", "filter", true))).toContain('"objectId"');
    expect(labels(complete("{ a: { $exists: |", "filter", true))).toEqual(["true", "false"]);
  });

  it("offers field references inside strings of aggregation expressions", () => {
    expect(labels(complete('{ total: { $sum: "$it|', "expression"))).toContain("$items.sku");
    expect(labels(complete('"$ad|', "expression"))).toContain("$address.city");
    expect(complete('{ name: "$a|', "filter")).toBeNull();
  });

  it("offers accumulators and expression operators inside new fields", () => {
    const nested = labels(complete("{ _id: 1, total: { $|", "expression"));
    expect(nested).toEqual(expect.arrayContaining(["$sum", "$concat", "$cond"]));
    expect(labels(complete("{ |", "expression"))).toContain("name");
  });

  it("suggests the known values of enum-like fields first", () => {
    const result = complete("{ plan: |", "filter", true);
    expect(labels(result).slice(0, 3)).toEqual(['"free"', '"pro"', '"team"']);
    expect(labels(complete('{ plan: { $in: ["|', "filter"))).toEqual(["free", "pro", "team"]);
    expect(labels(complete('{ plan: "p|', "filter"))).toContain("pro");
    expect(complete('{ name: "a|', "filter")).toBeNull();
  });

  it("suggests a document's fields and values while writing it", () => {
    expect(labels(complete("{ |", "document"))).toEqual(["_id", "name", "plan", "items"]);
    expect(labels(complete("{ address: { |", "document"))).toEqual(["city"]);
    expect(labels(complete("{ plan: |", "document", true)).slice(0, 1)).toEqual(['"free"']);
    expect(labels(complete("{ |", "document"))).not.toContain("$or");
  });
});
