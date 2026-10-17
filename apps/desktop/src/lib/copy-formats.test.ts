import { describe, expect, it } from "vitest";
import { formatValue } from "./copy-formats";

const doc = {
  _id: { $oid: "65f0a1c30000000000000001" },
  n: { $numberInt: "5" },
  big: { $numberLong: "9007199254740993" },
  price: { $numberDecimal: "1.50" },
  at: { $date: { $numberLong: "1700000000000" } },
  tags: ["a"],
};

describe("formatValue", () => {
  it("writes plain JSON with no digit lost", () => {
    expect(JSON.parse(formatValue(doc, "json"))).toEqual({
      _id: "65f0a1c30000000000000001",
      n: 5,
      big: "9007199254740993",
      price: "1.50",
      at: "2023-11-14T22:13:20.000Z",
      tags: ["a"],
    });
  });

  it("writes relaxed and canonical Extended JSON", () => {
    const relaxed = JSON.parse(formatValue(doc, "relaxed"));
    expect(relaxed._id).toEqual({ $oid: "65f0a1c30000000000000001" });
    expect(relaxed.n).toBe(5);
    expect(relaxed.at).toEqual({ $date: "2023-11-14T22:13:20Z" });
    expect(JSON.parse(formatValue(doc, "canonical"))).toEqual(doc);
  });

  it("writes mongosh syntax and arrays of documents", () => {
    expect(formatValue(doc, "shell")).toContain('NumberLong("9007199254740993")');
    expect(JSON.parse(formatValue([doc, doc], "json"))).toHaveLength(2);
  });
});
