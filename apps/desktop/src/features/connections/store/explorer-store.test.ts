import { beforeEach, describe, expect, it } from "vitest";
import { useExplorer } from "./explorer-store";

const store = () => useExplorer.getState();

beforeEach(() => useExplorer.setState({ expanded: new Set(), filter: "", revealing: null }));

describe("useExplorer", () => {
  it("revealing a collection opens its connection and database and clears the filter", () => {
    store().setFilter("orders");
    store().reveal("p1", "shop", "users");
    expect([...store().expanded]).toEqual(["p1", "p1/shop"]);
    expect(store().filter).toBe("");
    expect(store().revealing).toBe("p1/shop/users");
    store().revealed();
    expect(store().revealing).toBeNull();
  });

  it("collapses everything except the given keys", () => {
    store().setExpanded("p1", true);
    store().setExpanded("p1/shop", true);
    store().setExpanded("p1/shop", false);
    expect([...store().expanded]).toEqual(["p1"]);
    store().collapseAll(["group:clients"]);
    expect([...store().expanded]).toEqual(["group:clients"]);
  });
});
