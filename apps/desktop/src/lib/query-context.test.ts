import { describe, expect, it } from "vitest";
import { queryContext } from "./query-context";

/** `|` marks the cursor. */
function at(text: string) {
  const pos = text.indexOf("|");
  return queryContext(text.replace("|", ""), pos);
}

describe("queryContext", () => {
  it("completes top-level keys", () => {
    expect(at("{ sta|")).toEqual({ kind: "key", path: [], prefix: "sta", from: 2, quoted: false });
    expect(at("{ a: 1, |")).toMatchObject({ kind: "key", path: [], prefix: "" });
    expect(at("|")).toMatchObject({ kind: "key", path: [], prefix: "" });
  });

  it("reads an unbraced query as a document body", () => {
    expect(at("status: 1, ag|")).toMatchObject({ kind: "key", path: [], prefix: "ag" });
  });

  it("completes operators inside a field's document", () => {
    expect(at("{ age: { $g| } }")).toMatchObject({ kind: "key", path: ["age"], prefix: "$g" });
  });

  it("completes values after a colon", () => {
    expect(at("{ _id: Obj|")).toMatchObject({ kind: "value", key: "_id", prefix: "Obj" });
    expect(at('{ "address.city": |')).toMatchObject({ kind: "value", key: "address.city" });
  });

  it("tracks arrays and documents nested in them", () => {
    expect(at("{ tags: { $in: [Obj|")).toMatchObject({
      kind: "value",
      key: "$in",
      path: ["tags", "$in"],
    });
    expect(at("{ $or: [{ a: 1 }, { b|")).toMatchObject({
      kind: "key",
      path: ["$or"],
      prefix: "b",
    });
  });

  it("forgets closed documents", () => {
    expect(at("{ a: { $gt: 1 }, |")).toMatchObject({ kind: "key", path: [] });
  });

  it("completes quoted keys but not string values", () => {
    expect(at('{ "addr|')).toMatchObject({ kind: "key", prefix: "addr", from: 3, quoted: true });
    expect(at('{ name: "Ro|')).toBeNull();
  });

  it("ignores brackets and commas inside strings", () => {
    expect(at('{ name: "a, {b:", |')).toMatchObject({ kind: "key", path: [] });
  });
});
