import type { FieldSummary } from "@odin-db/bindings";
import { describe, expect, it } from "vitest";
import { examplePrompts } from "./example-prompts";

const field = (path: string, type: string, frequency = 1): FieldSummary => ({
  path,
  types: [type],
  frequency,
  values: ["secret"],
});

describe("examplePrompts", () => {
  it("builds one example per kind of field, from names only", () => {
    const examples = examplePrompts([
      field("_id", "objectId"),
      field("name", "string"),
      field("address.city", "string"),
      field("age", "int"),
      field("createdAt", "date"),
    ]);
    expect(examples).toEqual([
      { kind: "newest", field: "createdAt" },
      { kind: "greater", field: "age" },
      { kind: "contains", field: "name" },
    ]);
    expect(JSON.stringify(examples)).not.toContain("secret");
  });

  it("suggests looking for a sparse field when there is room", () => {
    expect(examplePrompts([field("name", "string"), field("deletedAt", "null", 0.2)])).toEqual([
      { kind: "contains", field: "name" },
      { kind: "missing", field: "deletedAt" },
    ]);
  });

  it("offers nothing without fields", () => {
    expect(examplePrompts([])).toEqual([]);
  });
});
