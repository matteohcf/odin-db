import type { IndexInfo } from "@odin-db/bindings";
import { describe, expect, it } from "vitest";
import { createIndexCommand } from "./create-index-command";

describe("createIndexCommand", () => {
  it("keeps the keys and every option, without server bookkeeping", () => {
    const index = {
      name: "email_1",
      keys: { email: { $numberInt: "1" } },
      definition: {
        v: { $numberInt: "2" },
        key: { email: { $numberInt: "1" } },
        name: "email_1",
        unique: true,
        partialFilterExpression: { active: true },
      },
    } as unknown as IndexInfo;
    expect(createIndexCommand("users", index)).toBe(
      'db.getCollection("users").createIndex({ email: 1 }, { name: "email_1", unique: true, partialFilterExpression: { active: true } })',
    );
  });
});
