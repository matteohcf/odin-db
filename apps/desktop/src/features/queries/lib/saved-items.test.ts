import { describe, expect, it } from "vitest";
import { savedItems, searchText } from "./saved-items";

const form = { filter: '{ status: "paid" }', sort: "", projection: "", skip: "", limit: "" };
const key = (collection: string) => JSON.stringify(["p1", "shop", collection]);

describe("saved items", () => {
  it("merges queries and pipelines, newest first, and skips broken keys", () => {
    const items = savedItems(
      { [key("orders")]: [{ form, ranAt: 10 }], "not json": [{ form, ranAt: 99 }] },
      {
        [key("users")]: [
          {
            name: "Signups",
            stages: [{ operator: "$match", body: "{}", enabled: true }],
            savedAt: 20,
          },
        ],
      },
    );
    expect(items.map((item) => [item.kind, item.collection])).toEqual([
      ["pipeline", "users"],
      ["query", "orders"],
    ]);
  });

  it("searches the collection, the name and the query text", () => {
    const [query] = savedItems({ [key("orders")]: [{ form, ranAt: 1 }] }, {});
    expect(query && searchText(query, "Local")).toContain("shop.orders");
    expect(query && searchText(query, "Local")).toContain("paid");
  });
});
