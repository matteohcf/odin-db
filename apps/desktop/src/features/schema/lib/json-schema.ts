import type { FieldSummary, JsonValue } from "@odin-db/bindings";

type JsonObject = { [key: string]: JsonValue };

/**
 * A starting `$jsonSchema` from sampled fields: each field's BSON types
 * (the sampler names them as `bsonType` expects), nested documents as
 * nested properties, and fields present in every sampled document as required.
 * Fields inside arrays are left out: one sample cannot tell their shape.
 */
export function jsonSchemaFromFields(fields: readonly FieldSummary[]): JsonObject {
  return { $jsonSchema: objectSchema(fields, "", true) };
}

function objectSchema(fields: readonly FieldSummary[], prefix: string, top: boolean): JsonObject {
  const children = fields.filter((field) => {
    if (!field.path.startsWith(prefix)) return false;
    return !field.path.slice(prefix.length).includes(".");
  });
  const properties: JsonObject = {};
  for (const field of children) {
    const name = field.path.slice(prefix.length);
    const types = field.types.filter((type) => type !== "undefined");
    const schema: JsonObject = { bsonType: types.length === 1 ? (types[0] ?? "") : types };
    if (types.length === 1 && types[0] === "object") {
      const nested = objectSchema(fields, `${field.path}.`, false);
      if (Object.keys(nested.properties as JsonObject).length > 0)
        schema.properties = nested.properties ?? {};
    }
    properties[name] = schema;
  }
  const required = top
    ? children.filter((field) => (field.frequency ?? 0) >= 1).map((field) => field.path)
    : [];
  return {
    bsonType: "object",
    ...(required.length > 0 ? { required } : {}),
    properties,
  };
}
