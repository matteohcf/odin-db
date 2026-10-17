import { describe, expect, it } from "vitest";
import { modeOf, nextMarked } from "./selection";

const sorted = (set: Set<number>) => [...set].sort((a, b) => a - b);

describe("nextMarked", () => {
  it("replaces, toggles and extends from the anchor", () => {
    expect(sorted(nextMarked(new Set([1, 2]), 1, 5, "replace"))).toEqual([5]);
    expect(sorted(nextMarked(new Set(), 2, 4, "toggle"))).toEqual([2, 4]);
    expect(sorted(nextMarked(new Set([2, 4]), 2, 4, "toggle"))).toEqual([2]);
    expect(sorted(nextMarked(new Set([2]), 2, 5, "range"))).toEqual([2, 3, 4, 5]);
    expect(sorted(nextMarked(new Set([7]), 7, 5, "range"))).toEqual([5, 6, 7]);
    expect(sorted(nextMarked(new Set(), null, 3, "range"))).toEqual([3]);
  });

  it("reads the mode from modifier keys", () => {
    expect(modeOf({ shiftKey: true, metaKey: true, ctrlKey: false })).toBe("range");
    expect(modeOf({ shiftKey: false, metaKey: false, ctrlKey: true })).toBe("toggle");
    expect(modeOf({ shiftKey: false, metaKey: false, ctrlKey: false })).toBe("replace");
  });
});
