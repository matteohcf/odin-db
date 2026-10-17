import { describe, expect, it } from "vitest";
import { parseDocuments } from "./clipboard-documents";

describe("parseDocuments", () => {
  it("reads one document, arrays and NDJSON", async () => {
    expect(await parseDocuments('{ "a": 1 }')).toEqual([{ a: { $numberInt: "1" } }]);
    expect(await parseDocuments('[{ "a": 1 }, { "a": 2 }]')).toHaveLength(2);
    expect(await parseDocuments('{"a":1}\n{"a":2}\n{"a":3}\n')).toHaveLength(3);
  });

  it("keeps types from mongosh syntax and Extended JSON", async () => {
    const [shell] = await parseDocuments(
      '{ _id: ObjectId("65f0a1c30000000000000001"), n: NumberLong("9") }',
    );
    expect(shell).toEqual({ _id: { $oid: "65f0a1c30000000000000001" }, n: { $numberLong: "9" } });
    const [ejson] = await parseDocuments('{ "_id": { "$oid": "65f0a1c30000000000000001" } }');
    expect(ejson).toEqual({ _id: { $oid: "65f0a1c30000000000000001" } });
  });

  it("refuses text that is not documents", async () => {
    await expect(parseDocuments("[1, 2]")).rejects.toThrow(/documents/);
    await expect(parseDocuments("hello world")).rejects.toThrow();
    expect(await parseDocuments("  ")).toEqual([]);
  });
});
