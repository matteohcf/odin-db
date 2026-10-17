import type { FieldSummary } from "@odin-db/bindings";
import { describe, expect, it } from "vitest";
import { jsonSchemaFromFields } from "./json-schema";

const field = (path: string, types: string[], frequency = 1): FieldSummary => ({
  path,
  types,
  frequency,
  values: [],
});

describe("jsonSchemaFromFields", () => {
  it("types fields, nests documents and requires fields always present", () => {
    const schema = jsonSchemaFromFields([
      field("_id", ["objectId"]),
      field("age", ["int", "null"], 0.8),
      field("address", ["object"]),
      field("address.city", ["string"]),
      field("items", ["array"]),
      field("items.sku", ["string"]),
    ]);
    expect(schema).toEqual({
      $jsonSchema: {
        bsonType: "object",
        required: ["_id", "address", "items"],
        properties: {
          _id: { bsonType: "objectId" },
          age: { bsonType: ["int", "null"] },
          address: { bsonType: "object", properties: { city: { bsonType: "string" } } },
          items: { bsonType: "array" },
        },
      },
    });
  });
});
