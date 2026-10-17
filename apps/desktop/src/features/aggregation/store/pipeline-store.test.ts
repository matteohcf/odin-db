import { describe, expect, it } from "vitest";
import { templateFor } from "../lib/operators";
import { createPipelineStore } from "./pipeline-store";

describe("pipeline store", () => {
  it("adds stages after a given stage and moves them", () => {
    const store = createPipelineStore();
    const first = store.getState().stages[0]?.id ?? "";
    store.getState().add("$limit");
    store.getState().add("$sort", first);
    expect(store.getState().stages.map((s) => s.operator)).toEqual(["$match", "$sort", "$limit"]);

    const limit = store.getState().stages[2]?.id ?? "";
    store.getState().move(limit, -1);
    store.getState().move(limit, -1);
    store.getState().move(limit, -1);
    expect(store.getState().stages.map((s) => s.operator)).toEqual(["$limit", "$match", "$sort"]);
  });

  it("replaces the body on operator change only if it was untouched", () => {
    const store = createPipelineStore();
    const id = store.getState().stages[0]?.id ?? "";
    store.getState().setOperator(id, "$limit");
    expect(store.getState().stages[0]?.body).toBe(templateFor("$limit"));

    store.getState().update(id, { body: "25" });
    store.getState().setOperator(id, "$skip");
    expect(store.getState().stages[0]).toMatchObject({ operator: "$skip", body: "25" });
  });
});
