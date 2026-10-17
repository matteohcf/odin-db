import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { QueryForm } from "../lib/query-form";

const MAX_ENTRIES = 50;

interface HistoryEntry {
  form: QueryForm;
  ranAt: number;
}

interface QueryHistoryState {
  /** Most recent first, keyed by `historyKey`. */
  entries: Record<string, HistoryEntry[]>;
  record: (key: string, form: QueryForm) => void;
  clear: (key: string) => void;
}

export const historyKey = (profileId: string, database: string, collection: string) =>
  JSON.stringify([profileId, database, collection]);

const sameForm = (a: QueryForm, b: QueryForm) =>
  (Object.keys(a) as (keyof QueryForm)[]).every((field) => a[field].trim() === b[field].trim());

const isEmpty = (form: QueryForm) => Object.values(form).every((value) => value.trim() === "");

/** Recent queries per collection, kept across restarts. */
export const useQueryHistory = create<QueryHistoryState>()(
  persist(
    (set) => ({
      entries: {},
      record: (key, form) => {
        if (isEmpty(form)) return;
        set((state) => {
          const previous = (state.entries[key] ?? []).filter(
            (entry) => !sameForm(entry.form, form),
          );
          const entries = [{ form, ranAt: Date.now() }, ...previous].slice(0, MAX_ENTRIES);
          return { entries: { ...state.entries, [key]: entries } };
        });
      },
      clear: (key) =>
        set((state) => {
          const { [key]: _, ...rest } = state.entries;
          return { entries: rest };
        }),
    }),
    { name: "odin-query-history", version: 1 },
  ),
);
