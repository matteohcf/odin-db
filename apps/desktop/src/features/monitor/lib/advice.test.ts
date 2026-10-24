import { describe, expect, it } from "vitest";
import { createIndexCommand, formatMillis } from "./advice";

describe("index advice", () => {
  it("writes a createIndex command that works with any collection name", () => {
    expect(
      createIndexCommand({ database: "shop", collection: "order-lines" }, "{ status: 1 }"),
    ).toBe('db.getSiblingDB("shop").getCollection("order-lines").createIndex({ status: 1 })');
  });

  it("formats total time in a readable unit", () => {
    expect([340, 4200, 210_000].map((ms) => formatMillis(ms, "en"))).toEqual([
      "340 ms",
      "4.2 s",
      "3.5 min",
    ]);
  });
});
