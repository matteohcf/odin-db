import type { DatabaseDiagram, DiagramCollection } from "@odin-db/bindings";
import { describe, expect, it } from "vitest";
import { annotate, drawnLink, linkId, NO_ANNOTATIONS } from "./annotations";

const collection = (name: string, fields: [string, string][] = []): DiagramCollection => ({
  name,
  kind: "collection",
  documents: 1,
  fields: fields.map(([path, type]) => ({ path, types: [type], frequency: 1, values: [] })),
  error: null,
});
const inferred = {
  from: "orders",
  field: "customerId",
  to: "customers",
  many: false,
  matched: 5,
  checked: 5,
};
const diagram: DatabaseDiagram = {
  collections: [
    collection("customers"),
    collection("orders", [
      ["sku", "string"],
      ["tags", "array"],
    ]),
  ],
  links: [inferred],
};

describe("annotate", () => {
  it("adds drawn references and marks them as manual", () => {
    const drawn = drawnLink(diagram, "orders", "sku", "customers");
    const result = annotate(diagram, { ...NO_ANNOTATIONS, links: [drawn] });
    expect(result.diagram.links).toEqual([inferred, drawn]);
    expect([...result.manual]).toEqual([linkId(drawn)]);
  });

  it("leaves out hidden inferred references", () => {
    const result = annotate(diagram, { ...NO_ANNOTATIONS, hidden: [linkId(inferred)] });
    expect(result.diagram.links).toEqual([]);
  });

  it("ignores drawn references to collections that are gone, or already inferred", () => {
    const gone = drawnLink(diagram, "orders", "sku", "products");
    const again = drawnLink(diagram, "orders", "customerId", "customers");
    const result = annotate(diagram, { ...NO_ANNOTATIONS, links: [gone, again] });
    expect(result.diagram.links).toEqual([inferred]);
    expect(result.manual.size).toBe(0);
  });
});

describe("drawnLink", () => {
  it("points at many from an array field", () => {
    expect(drawnLink(diagram, "orders", "tags", "customers").many).toBe(true);
    expect(drawnLink(diagram, "orders", "sku", "customers").many).toBe(false);
  });
});
