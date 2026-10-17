/** Stage operators offered by the builder, with a starting body for each. */
export const STAGE_OPERATORS = [
  { operator: "$match", template: "{\n  \n}" },
  { operator: "$project", template: "{\n  field: 1\n}" },
  { operator: "$addFields", template: '{\n  newField: "$field"\n}' },
  { operator: "$set", template: '{\n  field: "$otherField"\n}' },
  { operator: "$unset", template: '"field"' },
  { operator: "$group", template: '{\n  _id: "$field",\n  count: { $sum: 1 }\n}' },
  { operator: "$sort", template: "{\n  field: -1\n}" },
  { operator: "$limit", template: "10" },
  { operator: "$skip", template: "10" },
  { operator: "$unwind", template: '"$arrayField"' },
  {
    operator: "$lookup",
    template:
      '{\n  from: "collection",\n  localField: "field",\n  foreignField: "_id",\n  as: "joined"\n}',
  },
  { operator: "$count", template: '"total"' },
  { operator: "$sortByCount", template: '"$field"' },
  { operator: "$facet", template: "{\n  name: []\n}" },
  {
    operator: "$bucket",
    template: '{\n  groupBy: "$field",\n  boundaries: [0, 100],\n  default: "other"\n}',
  },
  { operator: "$bucketAuto", template: '{\n  groupBy: "$field",\n  buckets: 5\n}' },
  { operator: "$sample", template: "{\n  size: 10\n}" },
  { operator: "$replaceRoot", template: '{\n  newRoot: "$field"\n}' },
  { operator: "$replaceWith", template: '"$field"' },
  { operator: "$unionWith", template: '{\n  coll: "collection"\n}' },
  {
    operator: "$densify",
    template: '{\n  field: "field",\n  range: { step: 1, bounds: "full" }\n}',
  },
  { operator: "$fill", template: '{\n  output: { field: { method: "linear" } }\n}' },
  {
    operator: "$setWindowFields",
    template: '{\n  sortBy: { field: 1 },\n  output: { total: { $sum: "$value" } }\n}',
  },
  {
    operator: "$graphLookup",
    template:
      '{\n  from: "collection",\n  startWith: "$field",\n  connectFromField: "field",\n  connectToField: "_id",\n  as: "path"\n}',
  },
  {
    operator: "$geoNear",
    template: '{\n  near: { type: "Point", coordinates: [0, 0] },\n  distanceField: "distance"\n}',
  },
  { operator: "$redact", template: '"$$KEEP"' },
  { operator: "$out", template: '"collection"' },
  { operator: "$merge", template: '{\n  into: "collection"\n}' },
] as const;

export type StageOperator = (typeof STAGE_OPERATORS)[number]["operator"];

export function templateFor(operator: string): string {
  return STAGE_OPERATORS.find((entry) => entry.operator === operator)?.template ?? "{}";
}

/** Stages that write data: never previewed, confirmed before running. */
export function isWriteOperator(operator: string): boolean {
  return operator === "$out" || operator === "$merge";
}

/** Stages MongoDB only accepts first: previews cannot prepend a sampling stage before them. */
const FIRST_STAGE_ONLY = new Set([
  "$geoNear",
  "$search",
  "$searchMeta",
  "$vectorSearch",
  "$collStats",
  "$indexStats",
]);

export function mustBeFirst(operator: string): boolean {
  return FIRST_STAGE_ONLY.has(operator);
}
