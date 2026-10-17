import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ResultsView = "table" | "list";

/** How results are shown, remembered across tabs and restarts. */
export const useResultsView = create<{ view: ResultsView; setView: (view: ResultsView) => void }>()(
  persist((set) => ({ view: "table", setView: (view) => set({ view }) }), {
    name: "odin-results-view",
    version: 1,
  }),
);
