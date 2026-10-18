import { describe, expect, it } from "vitest";
import { percentOf } from "./install-update";

describe("percentOf", () => {
  it("rounds down and stops at 100", () => {
    expect(percentOf({ done: 50, total: 200 })).toBe(25);
    expect(percentOf({ done: 300, total: 200 })).toBe(100);
  });

  it("is unknown without a total", () => {
    expect(percentOf({ done: 50, total: null })).toBeNull();
  });
});
