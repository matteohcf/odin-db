import { describe, expect, it } from "vitest";
import { addFilterCondition, singleFieldSort, sortText } from "./query-edits";

describe("singleFieldSort", () => {
  it("reads one-field sorts in any quoting", () => {
    expect(singleFieldSort("{ age: -1 }")).toEqual({ field: "age", direction: -1 });
    expect(singleFieldSort('{"address.city":1}')).toEqual({ field: "address.city", direction: 1 });
    expect(singleFieldSort("name: 1")).toEqual({ field: "name", direction: 1 });
  });

  it("ignores compound or unusual sorts", () => {
    expect(singleFieldSort("{ a: 1, b: -1 }")).toBeNull();
    expect(singleFieldSort('{ score: { $meta: "textScore" } }')).toBeNull();
    expect(singleFieldSort("")).toBeNull();
  });

  it("writes sorts back, quoting dotted paths", () => {
    expect(sortText({ field: "address.city", direction: -1 })).toBe('{ "address.city": -1 }');
    expect(sortText(null)).toBe("");
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
