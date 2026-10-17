import { describe, expect, it } from "vitest";
import { momentOf, objectIdTime } from "./value-hints";

describe("value hints", () => {
  it("reads an ObjectId's creation time", () => {
    expect(objectIdTime("65f0a1c30000000000000001")?.toISOString()).toBe(
      "2024-03-12T18:41:07.000Z",
    );
    expect(objectIdTime("not-an-id")).toBeNull();
  });

  it("finds the moment of dates and ids", () => {
    expect(momentOf({ $date: { $numberLong: "1700000000000" } })).toEqual({
      kind: "date",
      date: new Date(1700000000000),
    });
    expect(momentOf({ $oid: "65f0a1c30000000000000001" })?.kind).toBe("objectId");
    expect(momentOf("text")).toBeNull();
    expect(momentOf({ $numberInt: "5" })).toBeNull();
  });
});
