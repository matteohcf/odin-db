import { describe, expect, it } from "vitest";
import { fitWidth } from "./columns";

describe("fitWidth", () => {
  it("fits the longest value, within limits", () => {
    const rows = [{ name: "Ada" }, { name: "Margaret Hamilton" }, {}];
    expect(fitWidth(rows, "name")).toBe(Math.round(17 * 7.3 + 40));
    expect(fitWidth([{ n: { $numberInt: "1" } }], "n")).toBe(64);
    expect(fitWidth([{ s: "x".repeat(500) }], "s")).toBe(640);
    expect(fitWidth([{ d: { a: 1, b: 2 } }], "d")).toBe(Math.round(12 * 7.3 + 40));
  });
});
