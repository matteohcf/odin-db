import { describe, expect, it } from "vitest";
import { isSameCollection, percentOf } from "./target";

describe("isSameCollection", () => {
  const side = { connectionId: "c1", database: "shop", collection: "users" };
  it("is true only for the very same collection", () => {
    expect(isSameCollection(side, { ...side })).toBe(true);
    expect(isSameCollection(side, { ...side, connectionId: "c2" })).toBe(false);
    expect(isSameCollection(side, { ...side, collection: "users_copy" })).toBe(false);
  });
});

describe("percentOf", () => {
  it("is a bounded whole percentage", () => {
    expect(percentOf(50, 200)).toBe(25);
    expect(percentOf(300, 200)).toBe(100);
    expect(percentOf(5, 0)).toBe(0);
    expect(percentOf(null, 10)).toBe(0);
  });
});
