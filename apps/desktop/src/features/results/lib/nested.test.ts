import { describe, expect, it } from "vitest";
import { isNested, PARENT_ID, stepInto } from "./nested";

const rows = [
  { _id: 1, items: [{ sku: "a", qty: 2 }, { sku: "b" }], address: { city: "Milano" } },
  { _id: 2, items: [], tags: ["x", "y"] },
  { _id: 3 },
];

describe("stepInto", () => {
  it("turns array elements into rows that remember their document", () => {
    const nested = stepInto(rows, ["items"]);
    expect(nested.rows).toEqual([
      { [PARENT_ID]: 1, sku: "a", qty: 2 },
      { [PARENT_ID]: 1, sku: "b" },
    ]);
    expect(nested.columns).toEqual([PARENT_ID, "sku", "qty"]);
  });

  it("goes several levels deep and wraps plain values", () => {
    expect(stepInto(rows, ["address"]).rows).toEqual([{ [PARENT_ID]: 1, city: "Milano" }]);
    expect(stepInto(rows, ["tags"]).rows).toEqual([
      { [PARENT_ID]: 2, value: "x" },
      { [PARENT_ID]: 2, value: "y" },
    ]);
    expect(stepInto([{ _id: 1, a: { b: [{ c: 1 }] } }], ["a", "b"]).rows).toEqual([
      { [PARENT_ID]: 1, c: 1 },
    ]);
  });

  it("tells documents from Extended JSON values", () => {
    expect(isNested({ city: "Milano" })).toBe(true);
    expect(isNested([1])).toBe(true);
    expect(isNested({ $oid: "65f0a1c30000000000000001" })).toBe(false);
    expect(isNested("x")).toBe(false);
  });
});
