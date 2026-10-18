import type { ProfileEntry } from "@odin-db/bindings";
import { describe, expect, it } from "vitest";
import { indexHint, profiledQuery } from "./profile";

const entry = (patch: Partial<ProfileEntry>): ProfileEntry => ({
  at: 0,
  op: "query",
  ns: "shop.users",
  millis: 120,
  docsExamined: 10,
  keysExamined: 10,
  returned: 10,
  planSummary: "IXSCAN { email: 1 }",
  appName: null,
  command: null,
  ...patch,
});

describe("indexHint", () => {
  it("flags collection scans that read documents", () => {
    expect(indexHint(entry({ planSummary: "COLLSCAN", docsExamined: 5000 }))).toBe("collscan");
    expect(indexHint(entry({ planSummary: "COLLSCAN", docsExamined: 0 }))).toBeNull();
  });

  it("flags index scans that still read far more than they return", () => {
    expect(indexHint(entry({ docsExamined: 50_000, returned: 3 }))).toBe("wasteful");
    expect(indexHint(entry({ docsExamined: 50, returned: 0 }))).toBeNull();
    expect(indexHint(entry({}))).toBeNull();
  });
});

describe("profiledQuery", () => {
  it("takes a find's filter and sort, in mongosh syntax", () => {
    expect(
      profiledQuery(
        entry({
          command: {
            find: "users",
            filter: { age: { $gt: { $numberInt: "30" } } },
            sort: { createdAt: { $numberInt: "-1" } },
          },
        }),
      ),
    ).toEqual({
      database: "shop",
      collection: "users",
      filter: "{ age: { $gt: 30 } }",
      sort: "{ createdAt: -1 }",
    });
  });

  it("takes an update's statement filter, and nothing from commands without one", () => {
    expect(profiledQuery(entry({ ns: "shop.orders", command: { q: { paid: false } } }))).toEqual({
      database: "shop",
      collection: "orders",
      filter: "{ paid: false }",
      sort: "",
    });
    expect(profiledQuery(entry({ command: { createIndexes: "users" } }))).toBeNull();
    expect(profiledQuery(entry({ command: null }))).toBeNull();
  });
});
