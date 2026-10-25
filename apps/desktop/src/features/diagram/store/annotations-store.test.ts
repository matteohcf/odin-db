import { beforeEach, describe, expect, it } from "vitest";
import { linkId } from "../lib/annotations";
import { useAnnotations } from "./annotations-store";

const link = {
  from: "orders",
  field: "customerId",
  to: "customers",
  many: false,
  matched: 0,
  checked: 0,
};
const store = () => useAnnotations.getState();

beforeEach(() => useAnnotations.setState({ byDatabase: {} }));

describe("useAnnotations", () => {
  it("draws a reference once, and per database", () => {
    store().addLink("p/shop", link);
    store().addLink("p/shop", link);
    expect(store().byDatabase["p/shop"]?.links).toHaveLength(1);
    expect(store().byDatabase["p/other"]).toBeUndefined();
  });

  it("drawing a hidden inferred reference shows it again instead of duplicating it", () => {
    const id = linkId(link);
    store().hideLink("p/shop", id);
    store().hideLink("p/shop", id);
    expect(store().byDatabase["p/shop"]?.hidden).toEqual([id]);
    store().addLink("p/shop", link);
    expect(store().byDatabase["p/shop"]?.hidden).toEqual([]);
    expect(store().byDatabase["p/shop"]?.links).toEqual([]);
  });

  it("edits and removes notes and areas by id", () => {
    store().addNote("k", { id: "n1", text: "a", position: { x: 0, y: 0 }, width: 100, height: 80 });
    store().updateNote("k", "n1", { text: "b" });
    expect(store().byDatabase.k?.notes[0]?.text).toBe("b");
    store().removeNote("k", "n1");
    expect(store().byDatabase.k?.notes).toEqual([]);
    store().addArea("k", {
      id: "a1",
      label: "Billing",
      color: "blue",
      position: { x: 0, y: 0 },
      width: 300,
      height: 200,
    });
    store().updateArea("k", "a1", { color: "green" });
    expect(store().byDatabase.k?.areas[0]?.color).toBe("green");
  });
});
