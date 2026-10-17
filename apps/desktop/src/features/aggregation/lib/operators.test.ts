import { describe, expect, it } from "vitest";
import { templateFor } from "./operators";

describe("templateFor", () => {
  it("fills in a real field when one is known", () => {
    expect(templateFor("$group", "type")).toBe('{\n  _id: "$type",\n  count: { $sum: 1 }\n}');
    expect(templateFor("$project", "plan")).toBe("{\n  plan: 1\n}");
    expect(templateFor("$unset", "address.city")).toBe('"address.city"');
    expect(templateFor("$sort", "created at")).toBe('{\n  "created at": -1\n}');
  });

  it("keeps the placeholder otherwise", () => {
    expect(templateFor("$group")).toContain('"$field"');
  });
});
