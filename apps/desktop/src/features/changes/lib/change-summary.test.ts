import type { ChangeEvent } from "@odin-db/bindings";
import { describe, expect, it } from "vitest";
import { idOf, summarize } from "./change-summary";

const change = (patch: Partial<ChangeEvent>): ChangeEvent => ({
  operation: "insert",
  at: 0,
  key: { _id: { $oid: "65f0a1c00000000000000001" } },
  document: null,
  updated: null,
  removed: [],
  ...patch,
});

describe("change summary", () => {
  it("names the document by its _id", () => {
    expect(idOf(change({}))).toBe("65f0a1c00000000000000001");
    expect(idOf(change({ key: null }))).toBe("");
  });

  it("says what an update set and removed", () => {
    const update = change({
      operation: "update",
      updated: { status: "paid", total: { $numberInt: "3" } },
      removed: ["draft"],
    });
    expect(summarize(update)).toBe('status: "paid", total: 3, −draft');
  });

  it("shows inserted documents and nothing for deletes", () => {
    expect(summarize(change({ document: { name: "Ada" } }))).toBe('{ name: "Ada" }');
    expect(summarize(change({ operation: "delete" }))).toBe("");
  });
});
