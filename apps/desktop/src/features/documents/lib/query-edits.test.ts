import { describe, expect, it } from "vitest";
import { addFilterCondition, nextSort, simpleSort, sortText, valueCondition } from "./query-edits";

describe("simpleSort", () => {
  it("reads field sorts in any quoting", () => {
    expect(simpleSort("{ age: -1 }")).toEqual([{ field: "age", direction: -1 }]);
    expect(simpleSort('{"address.city":1}')).toEqual([{ field: "address.city", direction: 1 }]);
    expect(simpleSort("name: 1, 'a b': -1")).toEqual([
      { field: "name", direction: 1 },
      { field: "a b", direction: -1 },
    ]);
    expect(simpleSort("")).toEqual([]);
  });

  it("gives up on sorts it cannot show on columns", () => {
    expect(simpleSort('{ score: { $meta: "textScore" } }')).toBeNull();
    expect(simpleSort("{ a: 2 }")).toBeNull();
  });

  it("writes sorts back, quoting dotted paths", () => {
    expect(sortText([{ field: "address.city", direction: -1 }])).toBe('{ "address.city": -1 }');
    expect(
      sortText([
        { field: "age", direction: 1 },
        { field: "name", direction: -1 },
      ]),
    ).toBe("{ age: 1, name: -1 }");
    expect(sortText([])).toBe("");
  });
});

describe("nextSort", () => {
  const age = { field: "age", direction: 1 } as const;
  it("cycles one column with plain clicks", () => {
    expect(nextSort([], "age", false)).toEqual([age]);
    expect(nextSort([age], "age", false)).toEqual([{ field: "age", direction: -1 }]);
    expect(nextSort([{ field: "age", direction: -1 }], "age", false)).toEqual([]);
    expect(nextSort([age], "name", false)).toEqual([{ field: "name", direction: 1 }]);
  });

  it("adds and cycles columns with Shift, keeping the others", () => {
    const both = nextSort([age], "name", true);
    expect(both).toEqual([age, { field: "name", direction: 1 }]);
    expect(nextSort(both, "age", true)).toEqual([
      { field: "age", direction: -1 },
      { field: "name", direction: 1 },
    ]);
    expect(nextSort([{ field: "age", direction: -1 }, both[1] ?? age], "age", true)).toEqual([
      { field: "name", direction: 1 },
    ]);
  });
});

describe("addFilterCondition", () => {
  it("starts a filter", () => {
    expect(addFilterCondition("", "plan", '"pro"')).toBe('{ plan: "pro" }');
    expect(addFilterCondition("{}", "plan", '"pro"')).toBe('{ plan: "pro" }');
  });

  it("appends to an existing filter, with or without braces", () => {
    expect(addFilterCondition("{ age: { $gt: 30 } }", "plan", '"pro"')).toBe(
      '{ age: { $gt: 30 }, plan: "pro" }',
    );
    expect(addFilterCondition("age: 3", "address.city", '"Rome"')).toBe(
      '{ age: 3, "address.city": "Rome" }',
    );
  });

  it("keeps both conditions when the field is already constrained", () => {
    expect(addFilterCondition("{ age: { $gt: 30 } }", "age", "45")).toBe(
      "{ $and: [{ age: { $gt: 30 } }, { age: 45 }] }",
    );
  });
});

describe("valueCondition", () => {
  it("compares the value in mongosh syntax", () => {
    expect(valueCondition("pro")).toBe('"pro"');
    expect(valueCondition({ $numberInt: "3" }, "gt")).toBe("{ $gt: 3 }");
    expect(valueCondition({ $date: { $numberLong: "0" } }, "lt")).toContain("$lt: ISODate(");
    expect(valueCondition(null, "ne")).toBe("{ $ne: null }");
  });

  it("treats a missing field as an existence check", () => {
    expect(valueCondition(undefined)).toBe("{ $exists: false }");
    expect(valueCondition(undefined, "ne")).toBe("{ $exists: true }");
  });
});
