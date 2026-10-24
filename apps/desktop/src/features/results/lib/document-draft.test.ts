import { terminateWorker } from "@mongodb-js/shell-bson-parser";
import { afterAll, describe, expect, it } from "vitest";
import { parseShellDocument } from "@/lib/shell-syntax";
import {
  checkDraft,
  type DraftField,
  draftToShell,
  emptyField,
  insertField,
  kindOfText,
  toDraft,
  updateField,
} from "./document-draft";

afterAll(() => terminateWorker());

const order = {
  _id: { $oid: "65f0a69b00000000000004d9" },
  total: { $numberDecimal: "0.99" },
  count: { $numberInt: "3" },
  ratio: { $numberDouble: "2.0" },
  items: [{ sku: "a", qty: { $numberLong: "2" } }],
  shipping: { city: "Rome", at: { $date: { $numberLong: "1700000000000" } } },
};

describe("document draft", () => {
  it("round-trips every type unchanged", async () => {
    expect(await parseShellDocument(draftToShell(toDraft(order)))).toEqual(order);
  });

  it("edits, removes and inserts nested fields", async () => {
    let draft = toDraft(order);
    const shipping = draft.find((field) => field.key === "shipping") as DraftField & {
      children: DraftField[];
    };
    const city = shipping.children.find((field) => field.key === "city");
    draft = updateField(draft, city?.id ?? "", (field) => ({ ...field, text: '"Milan"' }));
    draft = updateField(draft, draft.find((f) => f.key === "count")?.id ?? "", () => null);
    draft = insertField(
      draft,
      { ...emptyField(), key: "note", text: '"gift"' },
      {
        parentId: shipping.id,
      },
    );
    draft = insertField(
      draft,
      { ...emptyField(), key: "paid", text: "true" },
      {
        afterId: draft[0]?.id ?? "",
      },
    );
    const saved = await parseShellDocument(draftToShell(draft));
    expect(Object.keys(saved as object)).toEqual([
      "_id",
      "paid",
      "total",
      "ratio",
      "items",
      "shipping",
    ]);
    expect((saved as { shipping: unknown }).shipping).toMatchObject({
      city: "Milan",
      note: "gift",
    });
  });

  it("reports empty or repeated names and invalid values", async () => {
    const draft = [
      { ...emptyField(), key: "a", text: "1" },
      { ...emptyField(), key: "a", text: "2" },
      { ...emptyField(), key: "", text: "3" },
      { ...emptyField(), key: "b", text: "ObjectId(" },
    ];
    const problems = await checkDraft(draft);
    expect(problems.map((p) => p.id).sort()).toEqual(
      [draft[1]?.id, draft[2]?.id, draft[3]?.id].sort(),
    );
  });

  it("names the kind a value text spells", () => {
    expect(
      ['"a"', 'ObjectId("x")', 'ISODate("2024")', "true", "null", 'Long("5")', "-1.5", "foo"].map(
        kindOfText,
      ),
    ).toEqual(["string", "objectId", "date", "boolean", "null", "number", "number", "other"]);
  });
});
