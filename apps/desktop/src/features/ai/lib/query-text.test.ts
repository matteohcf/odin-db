import { describe, expect, it } from "vitest";
import { toQueryText } from "./query-text";

describe("toQueryText", () => {
  it("writes each part on one line, keeping BSON types", () => {
    expect(
      toQueryText({
        filter: {
          age: { $gt: { $numberInt: "30" } },
          createdAt: { $gte: { $date: { $numberLong: "1735689600000" } } },
        },
        sort: { createdAt: { $numberInt: "-1" } },
        projection: null,
        limit: 10,
      }),
    ).toEqual({
      filter: '{ age: { $gt: 30 }, createdAt: { $gte: ISODate("2025-01-01T00:00:00.000Z") } }',
      sort: "{ createdAt: -1 }",
      projection: "",
      limit: "10",
    });
  });

  it("leaves an empty filter empty", () => {
    expect(toQueryText({ filter: {}, sort: null, projection: null, limit: null }).filter).toBe("");
  });
});
