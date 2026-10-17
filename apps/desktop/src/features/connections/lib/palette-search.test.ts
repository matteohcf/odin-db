import { describe, expect, it } from "vitest";
import { matchScore, rankMatches } from "./palette-search";

describe("palette search", () => {
  it("prefers prefixes, then word starts, then substrings, then letters in order", () => {
    const names = ["shop.order_items", "shop.orders", "analytics.events", "shop.users"];
    expect(rankMatches(names, "orders", (n) => n, 10)).toEqual(["shop.orders", "shop.order_items"]);
    expect(rankMatches(names, "shop", (n) => n, 10)[0]).toBe("shop.users");
    expect(rankMatches(names, "usr", (n) => n, 10)).toEqual(["shop.users"]);
    expect(rankMatches(names, "ev", (n) => n, 10)).toEqual(["analytics.events"]);
  });

  it("matches everything for an empty query and caps results", () => {
    expect(matchScore("anything", "  ")).toBe(0);
    expect(rankMatches(["a", "b", "c"], "", (n) => n, 2)).toEqual(["a", "b"]);
  });

  it("rejects letters out of order", () => {
    expect(matchScore("users", "sru")).toBeNull();
  });
});
