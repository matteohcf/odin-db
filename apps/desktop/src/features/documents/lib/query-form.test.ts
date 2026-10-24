import { terminateWorker } from "@mongodb-js/shell-bson-parser";
import { afterAll, describe, expect, it } from "vitest";
import { emptyQueryForm, parseQueryForm } from "./query-form";

afterAll(() => terminateWorker());
const messages = { invalidNumber: "bad number" };

describe("parseQueryForm", () => {
  it("parses an empty form into a match-all query", async () => {
    expect(await parseQueryForm(emptyQueryForm, messages)).toEqual({
      ok: true,
      query: { filter: {}, sort: null, projection: null, skip: null, limit: null },
    });
  });

  it("parses shell syntax into canonical EJSON", async () => {
    const result = await parseQueryForm(
      { ...emptyQueryForm, filter: "{ age: { $gt: 30 } }", sort: "{ age: -1 }", limit: "50" },
      messages,
    );
    expect(result).toEqual({
      ok: true,
      query: {
        filter: { age: { $gt: { $numberInt: "30" } } },
        sort: { age: { $numberInt: "-1" } },
        projection: null,
        skip: null,
        limit: 50,
      },
    });
  });

  it("accepts documents without their braces", async () => {
    const result = await parseQueryForm(
      { ...emptyQueryForm, filter: 'status: "active"' },
      messages,
    );
    expect(result).toMatchObject({ ok: true, query: { filter: { status: "active" } } });
  });

  it("reports every invalid field at once", async () => {
    const result = await parseQueryForm(
      { ...emptyQueryForm, filter: "{ a: ", skip: "-1", limit: "1.5" },
      messages,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.errors).sort()).toEqual(["filter", "limit", "skip"]);
      expect(result.errors.skip).toBe("bad number");
    }
  });

  it("parses collation, hint and time limit into query options", async () => {
    const result = await parseQueryForm(
      {
        ...emptyQueryForm,
        collation: "locale: 'en', strength: 2",
        hint: "'name_1'",
        maxTimeMS: "0",
      },
      messages,
    );
    expect(result).toMatchObject({
      ok: true,
      query: {
        options: {
          collation: { locale: "en", strength: { $numberInt: "2" } },
          hint: "name_1",
          maxTimeMs: 0,
        },
      },
    });
    const byKeys = await parseQueryForm({ ...emptyQueryForm, hint: "{ age: 1 }" }, messages);
    expect(byKeys).toMatchObject({
      ok: true,
      query: { options: { hint: { age: { $numberInt: "1" } } } },
    });
  });
});
