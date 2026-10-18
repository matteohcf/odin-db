import type { FieldSummary } from "@odin-db/bindings";
import { describe, expect, it } from "vitest";
import { parseShellDocument } from "@/lib/shell-syntax";
import { schemaTemplate } from "./schema-template";

const field = (path: string, type: string) =>
  ({ path, types: [type], frequency: 1 }) as unknown as FieldSummary;

describe("schemaTemplate", () => {
  it("shapes a new document like the sample, without _id", async () => {
    const text = schemaTemplate([
      field("_id", "objectId"),
      field("name", "string"),
      field("age", "int"),
      field("address", "object"),
      field("address.city", "string"),
      field("tags", "array"),
      field("items.sku", "string"),
      field("created at", "date"),
    ]);
    expect(text).toBe(
      '{\n  name: "",\n  age: 0,\n  address: {\n    city: ""\n  },\n  tags: [],\n  items: {\n    sku: ""\n  },\n  "created at": new Date()\n}',
    );
    await expect(parseShellDocument(text)).resolves.toBeTruthy();
  });

  it("leaves out fields most documents lack", () => {
    const rare = { path: "referrer", types: ["null"], frequency: 0.14 } as unknown as FieldSummary;
    expect(schemaTemplate([field("name", "string"), rare])).toBe('{\n  name: ""\n}');
  });

  it("leaves array elements out", () => {
    expect(schemaTemplate([field("items", "array"), field("items.sku", "string")])).toBe(
      "{\n  items: []\n}",
    );
  });
});
