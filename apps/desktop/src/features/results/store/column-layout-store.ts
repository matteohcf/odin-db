import { create } from "zustand";
import { persist } from "zustand/middleware";

/** How a collection's grid was arranged: kept by field name, so new runs keep it. */
interface ColumnLayout {
  order: readonly string[];
  pinned: readonly string[];
  widths: Readonly<Record<string, number>>;
  hidden: Readonly<Record<string, false>>;
}

/** Collections remembered; the least recently arranged are dropped first. */
const MAX_LAYOUTS = 300;

interface ColumnLayoutState {
  layouts: Record<string, ColumnLayout>;
  save: (key: string, layout: ColumnLayout) => void;
}

export const useColumnLayouts = create<ColumnLayoutState>()(
  persist(
    (set) => ({
      layouts: {},
      save: (key, layout) =>
        set((state) => {
          const { [key]: _, ...others } = state.layouts;
          const kept = Object.entries(others).slice(-(MAX_LAYOUTS - 1));
          return { layouts: { ...Object.fromEntries(kept), [key]: layout } };
        }),
    }),
    { name: "odin-column-layouts", version: 1 },
  ),
);
