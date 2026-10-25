import { describe, expect, it } from "vitest";
import { compareDocuments } from "./compare";

describe("compareDocuments", () => {
  it("reports changed, added, removed and equal leaves", () => {
    const rows = compareDocuments(
      { _id: { $oid: "65f0a1c30000000000000001" }, name: "Ada", tags: ["a", "b"], meta: { v: 1 } },
      {
        _id: { $oid: "65f0a1c30000000000000002" },
        name: "Ada",
        tags: ["a"],
        meta: { v: 2 },
        plan: "pro",
      },
    );
    expect(rows.map((row) => [row.path, row.status])).toEqual([
      ["_id", "changed"],
      ["name", "same"],
      ["tags.0", "same"],
      ["tags.1", "removed"],
      ["meta.v", "changed"],
      ["plan", "added"],
    ]);
  });

  it("tells numeric types apart and keeps empty structures", () => {
    const rows = compareDocuments(
      { n: { $numberInt: "5" }, e: {} },
      { n: { $numberLong: "5" }, e: [] },
    );
    expect(rows).toEqual([
      { path: "n", left: "5", right: 'NumberLong("5")', status: "changed" },
      { path: "e", left: expect.any(String), right: "[]", status: "changed" },
    ]);
  });
});
