import { describe, expect, it } from "vitest";
import { momentOf, objectIdTime, relativeTime } from "./value-hints";

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

  it("says how long ago, in the largest unit", () => {
    const now = new Date("2026-10-17T12:00:00Z");
    expect(relativeTime(new Date("2026-10-14T12:00:00Z"), now, "en")).toBe("3 days ago");
    expect(relativeTime(new Date("2026-10-17T14:00:00Z"), now, "en")).toBe("in 2 hours");
    expect(relativeTime(new Date("2026-10-16T12:00:00Z"), now, "it")).toBe("ieri");
  });
});
