import { describe, expect, it } from "vitest";
import { findMatches, MAX_MATCHES, stepMatch } from "./find";

const rows = [
  {
    _id: { $oid: "65a1b2c3d4e5f60718293a4b" },
    name: "Ada Lovelace",
    address: { city: "London", zip: "N1" },
    tags: ["math", "Engines"],
  },
  { _id: { $oid: "65a1b2c3d4e5f60718293a4c" }, name: "Alan", age: { $numberInt: "41" } },
];

describe("findMatches", () => {
  it("finds values in any field, ignoring case", () => {
    expect(findMatches(rows, "lovelace")).toEqual([{ row: 0, field: "name" }]);
    expect(findMatches(rows, "ENGINE")).toEqual([{ row: 0, field: "tags" }]);
  });

  it("finds field names, nested ones included", () => {
    expect(findMatches(rows, "city")).toEqual([{ row: 0, field: "address" }]);
    expect(findMatches(rows, "name")).toEqual([
      { row: 0, field: "name" },
      { row: 1, field: "name" },
    ]);
  });

  it("reads EJSON values as the cells show them", () => {
    expect(findMatches(rows, "293a4c")).toEqual([{ row: 1, field: "_id" }]);
    expect(findMatches(rows, "41")).toEqual([{ row: 1, field: "age" }]);
    // The wrapper's own key is not a field.
    expect(findMatches(rows, "$oid")).toEqual([]);
  });

  it("follows the given column order and skips missing fields", () => {
    expect(findMatches(rows, "a", ["tags", "name"])).toEqual([
      { row: 0, field: "tags" },
      { row: 0, field: "name" },
      { row: 1, field: "name" },
    ]);
  });

  it("finds nothing for blank text and stops counting at the cap", () => {
    expect(findMatches(rows, "  ")).toEqual([]);
    const many = Array.from({ length: MAX_MATCHES + 5 }, () => ({ name: "x" }));
    expect(findMatches(many, "x")).toHaveLength(MAX_MATCHES);
  });
});

describe("stepMatch", () => {
  it("wraps around both ways", () => {
    expect(stepMatch(2, 3, 1)).toBe(0);
    expect(stepMatch(0, 3, -1)).toBe(2);
    expect(stepMatch(-1, 3, 1)).toBe(0);
    expect(stepMatch(0, 0, 1)).toBe(-1);
  });
});
