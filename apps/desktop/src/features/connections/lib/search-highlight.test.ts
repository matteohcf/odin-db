import { describe, expect, it } from "vitest";
import { highlightParts, searchPattern } from "./search-highlight";

describe("highlightParts", () => {
  it("marks every match, ignoring case unless asked", () => {
    const pattern = searchPattern({ text: "mi", regex: false, caseSensitive: false });
    expect(highlightParts("Milano mi", pattern)).toEqual([
      { text: "Mi", match: true },
      { text: "lano ", match: false },
      { text: "mi", match: true },
    ]);
  });

  it("treats plain text literally and skips patterns JavaScript cannot read", () => {
    const dot = searchPattern({ text: "a.c", regex: false, caseSensitive: true });
    expect(highlightParts("abc a.c", dot)).toEqual([
      { text: "abc ", match: false },
      { text: "a.c", match: true },
    ]);
    expect(searchPattern({ text: "(?<", regex: true, caseSensitive: false })).toBeNull();
    const empty = searchPattern({ text: "x*", regex: true, caseSensitive: false });
    expect(highlightParts("ab", empty)).toEqual([{ text: "ab", match: false }]);
  });
});
