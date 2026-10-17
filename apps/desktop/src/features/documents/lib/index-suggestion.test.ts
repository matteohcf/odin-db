import { describe, expect, it } from "vitest";
import { suggestIndexKeys } from "./index-suggestion";

const int = (n: number) => ({ $numberInt: String(n) });

describe("suggestIndexKeys", () => {
  it("orders keys by equality, sort, then range", () => {
    expect(suggestIndexKeys({ age: { $gt: int(30) }, plan: "pro" }, { createdAt: int(-1) })).toBe(
      "{ plan: 1, createdAt: -1, age: 1 }",
    );
  });

  it("quotes dotted paths and skips top-level operators", () => {
    expect(suggestIndexKeys({ "address.city": "Rome", $or: [] }, null)).toBe(
      '{ "address.city": 1 }',
    );
  });

  it("has nothing to suggest for an empty query", () => {
    expect(suggestIndexKeys({}, null)).toBeNull();
    expect(suggestIndexKeys({ $text: { $search: "x" } }, null)).toBeNull();
  });
});
