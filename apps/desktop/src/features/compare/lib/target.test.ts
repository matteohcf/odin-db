import { describe, expect, it } from "vitest";
import { isSameCollection, percentOf, syncReady } from "./target";

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

describe("syncReady", () => {
  const none = { insertMissing: false, replaceDifferent: false, deleteExtra: false };
  it("needs at least one change", () => {
    expect(syncReady(none, "", "users")).toBe(false);
    expect(syncReady({ ...none, insertMissing: true }, "", "users")).toBe(true);
  });
  it("needs the collection name typed back to delete", () => {
    const deleting = { ...none, deleteExtra: true };
    expect(syncReady(deleting, "user", "users")).toBe(false);
    expect(syncReady(deleting, " users ", "users")).toBe(true);
  });
});
