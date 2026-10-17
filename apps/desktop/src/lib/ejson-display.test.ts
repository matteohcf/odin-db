import { describe, expect, it } from "vitest";
import { describeEJson } from "./ejson-display";

describe("describeEJson", () => {
  it.each([
    [{ $oid: "650000000000000000000001" }, "objectId", 'ObjectId("650000000000000000000001")'],
    [{ $numberInt: "5" }, "number", "5"],
    [{ $numberDouble: "5" }, "number", "5.0"],
    [{ $numberDouble: "-0.0" }, "number", "-0.0"],
    [{ $numberDouble: "NaN" }, "number", "NaN"],
    [{ $numberLong: "9223372036854775807" }, "number", 'Long("9223372036854775807")'],
    [{ $numberDecimal: "1.10" }, "number", 'Decimal128("1.10")'],
    [{ $date: { $numberLong: "0" } }, "date", 'ISODate("1970-01-01T00:00:00.000Z")'],
    [{ $date: { $numberLong: "99999999999999999" } }, "date", 'Date(Long("99999999999999999"))'],
    [
      { $binary: { base64: "AAE=", subType: "04" } },
      "binary",
      'Binary.createFromBase64("AAE=", 4)',
    ],
    [{ $timestamp: { t: 1, i: 2 } }, "other", "Timestamp({ t: 1, i: 2 })"],
    [{ $regularExpression: { pattern: "^a", options: "i" } }, "other", "/^a/i"],
    ["it's", "string", '"it\'s"'],
    [null, "null", "null"],
  ] as const)("renders %j as %s", (input, kind, text) => {
    expect(describeEJson(input)).toEqual({ kind, text });
  });

  it("renders nested documents and arrays with typed values", () => {
    const value = { a: [{ $numberInt: "1" }, { $numberLong: "2" }], "b-c": { d: true } };
    expect(describeEJson(value)).toEqual({
      kind: "document",
      text: '{ a: [1, Long("2")], "b-c": { d: true } }',
    });
  });

  it("treats objects with several keys as documents even if one starts with $", () => {
    expect(describeEJson({ $oid: "x", other: 1 }).kind).toBe("document");
  });
});
