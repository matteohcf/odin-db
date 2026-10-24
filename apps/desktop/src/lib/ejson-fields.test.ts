import { describe, expect, it } from "vitest";
import { fieldPathsOf } from "./ejson-fields";

describe("fieldPathsOf", () => {
  it("summarizes canonical EJSON like core's sampler", () => {
    const fields = fieldPathsOf([
      {
        _id: { $oid: "65f0a1c30000000000000001" },
        address: { city: "Rome" },
        items: [{ sku: "a", ids: [{ $oid: "65f0a1c30000000000000002" }] }],
      },
      { _id: { $oid: "65f0a1c30000000000000003" }, age: { $numberInt: "3" } },
    ]);
    const byPath = Object.fromEntries(fields.map((field) => [field.path, field]));

    expect(fields[0]?.path).toBe("_id");
    expect(byPath._id?.types).toEqual(["objectId"]);
    expect(byPath["address.city"]).toEqual({
      path: "address.city",
      types: ["string"],
      typeShares: [1],
      frequency: 0.5,
      values: ["Rome"],
    });
    expect(byPath["items.sku"]?.types).toEqual(["string"]);
    expect(byPath.age?.types).toEqual(["int"]);
    expect(fieldPathsOf([{ tags: ["a", "b"] }, { tags: ["a"] }])[0]?.values).toEqual(["a", "b"]);
    // Wrappers are values, never paths.
    expect(fields.some((field) => field.path.includes("$"))).toBe(false);
  });
});
