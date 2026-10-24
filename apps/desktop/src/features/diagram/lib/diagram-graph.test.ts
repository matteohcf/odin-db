import type { DatabaseDiagram, DiagramCollection } from "@odin-db/bindings";
import { describe, expect, it } from "vitest";
import { buildGraph, fieldsOf, HEADER_HANDLE, MAX_ROWS } from "./diagram-graph";

const field = (path: string, type = "string") => ({
  path,
  types: [type],
  typeShares: [1],
  frequency: 1,
  values: [],
});
const collection = (name: string, fields: ReturnType<typeof field>[]): DiagramCollection => ({
  name,
  kind: "collection",
  documents: 10,
  fields,
  error: null,
});
const diagram: DatabaseDiagram = {
  collections: [
    collection("customers", [field("_id", "objectId"), field("name")]),
    collection("orders", [
      field("total", "decimal"),
      field("_id", "objectId"),
      field("customerId", "objectId"),
      field("items"),
      field("items.productId", "objectId"),
    ]),
    collection("products", [field("_id", "objectId")]),
  ],
  links: [
    { from: "orders", field: "customerId", to: "customers", many: false, matched: 5, checked: 5 },
    {
      from: "orders",
      field: "items.productId",
      to: "products",
      many: true,
      matched: 4,
      checked: 5,
    },
  ],
};

describe("diagram graph", () => {
  it("keeps nested fields under their parent; keys mode lists _id and references flat", () => {
    const orders = diagram.collections[1] as DiagramCollection;
    const all = fieldsOf(orders, diagram.links, "all");
    expect(all.fields.map((f) => f.path)).toEqual([
      "_id",
      "total",
      "customerId",
      "items",
      "items.productId",
    ]);
    expect(all.fields[4]).toMatchObject({ depth: 1, references: "products", many: true });
    const keys = fieldsOf(orders, diagram.links, "keys");
    expect(keys.fields.map((f) => f.path)).toEqual(["_id", "customerId", "items.productId"]);
    expect(keys.fields[2]).toMatchObject({ depth: 0, label: "items.productId" });
    expect(keys.hidden).toBe(2);
  });

  it("lays referencing collections before the ones they point at, keeping dragged positions", () => {
    const { nodes, edges } = buildGraph(diagram, "all", { products: { x: 7, y: 9 } });
    const x = (name: string) => nodes.find((node) => node.id === name)?.position.x ?? 0;
    expect(x("orders")).toBeLessThan(x("customers"));
    expect(nodes.find((node) => node.id === "products")?.position).toEqual({ x: 7, y: 9 });
    expect(edges.map((edge) => edge.sourceHandle)).toEqual(["customerId", "items.productId"]);
    expect(nodes.find((node) => node.id === "customers")?.data.incoming).toBe(1);
  });

  it("an edge whose field row is cut leaves from the header", () => {
    const wide = collection("wide", [
      field("_id", "objectId"),
      ...Array.from({ length: MAX_ROWS + 3 }, (_, i) => field(`f${i}`)),
    ]);
    wide.fields.push(field("ownerId", "objectId"));
    const many = Array.from({ length: MAX_ROWS }, (_, i) => ({
      from: "wide",
      field: `f${i}`,
      to: "customers",
      many: false,
      matched: 1,
      checked: 1,
    }));
    const { edges } = buildGraph(
      {
        collections: [diagram.collections[0] as DiagramCollection, wide],
        links: [...many, { ...(many[0] as (typeof many)[0]), field: "ownerId" }],
      },
      "all",
    );
    expect(edges.at(-1)?.sourceHandle).toBe(HEADER_HANDLE);
  });
});
