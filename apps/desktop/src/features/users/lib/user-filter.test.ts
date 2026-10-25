import { describe, expect, it } from "vitest";
import { userMatches } from "./user-filter";

const user = {
  user: "shop-api",
  db: "shop",
  roles: [{ role: "readWrite", db: "analytics" }],
  mechanisms: [],
};

describe("userMatches", () => {
  it("matches the name, database and roles, ignoring case", () => {
    expect(userMatches(user, "")).toBe(true);
    expect(userMatches(user, "API")).toBe(true);
    expect(userMatches(user, "readwrite")).toBe(true);
    expect(userMatches(user, "write@analytics")).toBe(true);
    expect(userMatches(user, "root")).toBe(false);
  });
});
