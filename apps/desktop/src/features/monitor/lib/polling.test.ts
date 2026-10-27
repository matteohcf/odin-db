import { describe, expect, it } from "vitest";
import { pollUntilError } from "./polling";

describe("pollUntilError", () => {
  it("stops polling once the query failed", () => {
    expect(pollUntilError(2000)({ state: { status: "success" } })).toBe(2000);
    expect(pollUntilError(2000)({ state: { status: "error" } })).toBe(false);
    expect(pollUntilError(false)({ state: { status: "success" } })).toBe(false);
  });
});
