import { terminateWorker } from "@mongodb-js/shell-bson-parser";
import { afterAll, describe, expect, it } from "vitest";
import { emptyDraft, toCollectionOptions } from "./collection-options";

afterAll(() => terminateWorker());
const messages = { required: "required", invalidNumber: "bad number" };

describe("toCollectionOptions", () => {
  it("creates a standard collection by default", async () => {
    expect(await toCollectionOptions(emptyDraft, messages)).toEqual({
      ok: true,
      options: { kind: { kind: "standard" }, collation: null },
    });
  });

  it("converts a capped size from megabytes", async () => {
    const result = await toCollectionOptions(
      { ...emptyDraft, type: "capped", sizeMb: "1.5", maxDocuments: "100" },
      messages,
    );
    expect(result).toMatchObject({
      ok: true,
      options: { kind: { kind: "capped", sizeBytes: 1_572_864, maxDocuments: 100 } },
    });
  });

  it("asks for what each type needs", async () => {
    const capped = await toCollectionOptions({ ...emptyDraft, type: "capped" }, messages);
    expect(capped).toEqual({ ok: false, errors: { sizeMb: "required" } });
    const series = await toCollectionOptions(
      { ...emptyDraft, type: "timeSeries", expireAfterSeconds: "1.5", collation: "{ a: " },
      messages,
    );
    expect(series.ok).toBe(false);
    if (!series.ok)
      expect(Object.keys(series.errors).sort()).toEqual([
        "collation",
        "expireAfterSeconds",
        "timeField",
      ]);
  });

  it("keeps fields of other types out", async () => {
    const result = await toCollectionOptions(
      {
        ...emptyDraft,
        type: "clustered",
        sizeMb: "abc",
        timeField: "at",
        collation: "locale: 'fr'",
      },
      messages,
    );
    expect(result).toEqual({
      ok: true,
      options: {
        kind: { kind: "clustered", expireAfterSeconds: null },
        collation: { locale: "fr" },
      },
    });
  });
});
