import { beforeEach, describe, expect, it } from "vitest";
import { emptyQueryForm } from "../lib/query-form";
import { historyKey, useQueryHistory } from "./query-history-store";

const key = historyKey("p", "shop", "orders");
const entries = () => useQueryHistory.getState().entries[key] ?? [];

describe("query history", () => {
  beforeEach(() => useQueryHistory.setState({ entries: {}, saved: {} }));

  it("keeps the latest run first and drops duplicates", () => {
    const { record } = useQueryHistory.getState();
    record(key, { ...emptyQueryForm, filter: "{ a: 1 }" });
    record(key, { ...emptyQueryForm, filter: "{ b: 1 }" });
    record(key, { ...emptyQueryForm, filter: " { a: 1 } " });
    expect(entries().map((entry) => entry.form.filter)).toEqual([" { a: 1 } ", "{ b: 1 }"]);
  });

  it("ignores empty queries and is scoped per collection", () => {
    const { record } = useQueryHistory.getState();
    record(key, emptyQueryForm);
    record(historyKey("p", "shop", "users"), { ...emptyQueryForm, sort: "{ a: 1 }" });
    expect(entries()).toEqual([]);
  });

  it("caps the number of entries", () => {
    const { record } = useQueryHistory.getState();
    for (let i = 0; i < 60; i++) record(key, { ...emptyQueryForm, limit: String(i) });
    expect(entries()).toHaveLength(50);
    expect(entries()[0]?.form.limit).toBe("59");
  });

  it("saves a query once and unsaves it on a second toggle", () => {
    const { toggleSaved } = useQueryHistory.getState();
    const form = { ...emptyQueryForm, filter: "{ a: 1 }" };
    toggleSaved(key, form);
    toggleSaved(key, { ...emptyQueryForm, filter: "{ b: 1 }" });
    expect(useQueryHistory.getState().saved[key]?.map((entry) => entry.form.filter)).toEqual([
      "{ b: 1 }",
      "{ a: 1 }",
    ]);
    toggleSaved(key, { ...form, filter: " { a: 1 }" });
    expect(useQueryHistory.getState().saved[key]?.map((entry) => entry.form.filter)).toEqual([
      "{ b: 1 }",
    ]);
  });

  it("clearing history keeps saved queries", () => {
    const { record, toggleSaved, clear } = useQueryHistory.getState();
    record(key, { ...emptyQueryForm, filter: "{ a: 1 }" });
    toggleSaved(key, { ...emptyQueryForm, filter: "{ a: 1 }" });
    clear(key);
    expect(entries()).toEqual([]);
    expect(useQueryHistory.getState().saved[key]).toHaveLength(1);
  });
});
