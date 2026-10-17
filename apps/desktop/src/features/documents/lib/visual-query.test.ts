import { describe, expect, it } from "vitest";
import { parseShellDocument } from "@/lib/shell-syntax";
import { buildFilter, type Condition, OPERATORS, valueLiteral } from "./visual-query";

const types: Record<string, string[]> = {
  age: ["int"],
  price: ["decimal"],
  _id: ["objectId"],
  createdAt: ["date"],
  active: ["bool"],
  name: ["string"],
  "address.city": ["string"],
};
const typesOf = (field: string) => types[field] ?? [];
const row = (field: string, operator: Condition["operator"], value = ""): Condition => ({
  field,
  operator,
  value,
});

describe("valueLiteral", () => {
  it("types values after the field", () => {
    expect(valueLiteral("42", ["int"])).toBe("42");
    expect(valueLiteral("1.50", ["decimal"])).toBe('Decimal128("1.50")');
    expect(valueLiteral("65f0a1c30000000000000001", ["objectId"])).toBe(
      'ObjectId("65f0a1c30000000000000001")',
    );
    expect(valueLiteral("2024-03-01", ["date"])).toBe('ISODate("2024-03-01T00:00:00.000Z")');
    expect(valueLiteral("true", ["bool"])).toBe("true");
    expect(valueLiteral("42", ["string"])).toBe('"42"');
    expect(valueLiteral("null", ["string"])).toBe("null");
  });
});

describe("buildFilter", () => {
  it("writes one condition, several fields, and repeated fields", () => {
    expect(buildFilter([row("age", "gte", "30")], "and", typesOf)).toBe("{ age: { $gte: 30 } }");
    expect(
      buildFilter([row("age", "gte", "30"), row("active", "eq", "true")], "and", typesOf),
    ).toBe("{ age: { $gte: 30 }, active: true }");
    expect(buildFilter([row("age", "gt", "1"), row("age", "lt", "9")], "and", typesOf)).toBe(
      "{ $and: [{ age: { $gt: 1 } }, { age: { $lt: 9 } }] }",
    );
    expect(buildFilter([row("age", "lt", "18"), row("age", "gt", "65")], "or", typesOf)).toBe(
      "{ $or: [{ age: { $lt: 18 } }, { age: { $gt: 65 } }] }",
    );
  });

  it("handles lists, text matches, presence and dotted paths", () => {
    expect(buildFilter([row("age", "in", "1, 2,,3")], "and", typesOf)).toBe(
      "{ age: { $in: [1, 2, 3] } }",
    );
    expect(buildFilter([row("name", "contains", "a.b")], "and", typesOf)).toBe(
      '{ name: { $regex: "a\\\\.b", $options: "i" } }',
    );
    expect(buildFilter([row("name", "startsWith", "Ad")], "and", typesOf)).toBe(
      '{ name: { $regex: "^Ad" } }',
    );
    expect(buildFilter([row("address.city", "missing")], "and", typesOf)).toBe(
      '{ "address.city": { $exists: false } }',
    );
  });

  it("ignores incomplete rows", () => {
    expect(buildFilter([row("", "eq", "x"), row("age", "gt")], "and", typesOf)).toBe("");
  });

  it("always writes syntax the query parser accepts, with exact types", async () => {
    for (const operator of OPERATORS) {
      for (const field of Object.keys(types)) {
        const value =
          {
            age: "7",
            price: "2.5",
            _id: "65f0a1c30000000000000001",
            createdAt: "2024-01-01",
            active: "false",
          }[field] ?? 'say "hi" \\ ok';
        const text = buildFilter([row(field, operator, value)], "and", typesOf);
        await expect(
          parseShellDocument(text),
          `${field} ${operator}: ${text}`,
        ).resolves.toBeTruthy();
      }
    }
    const parsed = await parseShellDocument(
      buildFilter([row("price", "eq", "2.5")], "and", typesOf),
    );
    expect(parsed).toEqual({ price: { $numberDecimal: "2.5" } });
  });
});
