import { describe, expect, it } from "vitest";
import { columnSlots, fitWidth } from "./columns";

describe("fitWidth", () => {
  it("fits the longest value, within limits", () => {
    const rows = [{ name: "Ada" }, { name: "Margaret Hamilton" }, {}];
    expect(fitWidth(rows, "name")).toBe(Math.round(17 * 7.3 + 40));
    expect(fitWidth([{ n: { $numberInt: "1" } }], "n")).toBe(64);
    expect(fitWidth([{ s: "x".repeat(500) }], "s")).toBe(640);
    expect(fitWidth([{ d: { a: 1, b: 2 } }], "d")).toBe(Math.round(12 * 7.3 + 40));
  });
});

describe("columnSlots", () => {
  it("renders every column without spacers when all are in view", () => {
    expect(columnSlots([100, 50, 80], [0, 1, 2])).toEqual([
      { index: 0 },
      { index: 1 },
      { index: 2 },
    ]);
  });

  it("replaces skipped columns with spacers of their total width", () => {
    expect(columnSlots([100, 50, 80, 40, 60], [0, 3, 2])).toEqual([
      { index: 0 },
      { gap: 50, key: "gap-2" },
      { index: 2 },
      { index: 3 },
      { gap: 60, key: "gap-end" },
    ]);
  });

  it("ignores out-of-range and duplicate indexes", () => {
    expect(columnSlots([10, 20], [-1, 1, 1, 5])).toEqual([{ gap: 10, key: "gap-1" }, { index: 1 }]);
  });
});
