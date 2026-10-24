import { describe, expect, it } from "vitest";
import { toMermaid } from "./mermaid";

const field = (path: string, type: string) => ({
  path,
  types: [type],
  typeShares: [1],
  frequency: 1,
  values: [],
});

describe("toMermaid", () => {
  it("writes entities with keys and relationships with cardinality", () => {
    const text = toMermaid({
      collections: [
        {
          name: "orders",
          kind: "collection",
          documents: 1,
          error: null,
          fields: [
            field("_id", "objectId"),
            field("customerId", "objectId"),
            field("items", "array"),
            field("items.productId", "objectId"),
          ],
        },
        { name: "order-lines.v2", kind: "collection", documents: 1, error: null, fields: [] },
      ],
      links: [
        { from: "orders", field: "customerId", to: "users", many: false, matched: 1, checked: 1 },
        {
          from: "orders",
          field: "items.productId",
          to: "products",
          many: true,
          matched: 1,
          checked: 1,
        },
      ],
    });
    expect(text).toBe(
      [
        "erDiagram",
        "  orders {",
        "    objectId _id PK",
        "    objectId customerId FK",
        "    array items",
        "  }",
        "  order-lines_v2 {",
        "  }",
        '  orders }o--|| users : "customerId"',
        '  orders }o--o{ products : "items.productId"',
        "",
      ].join("\n"),
    );
  });
});
