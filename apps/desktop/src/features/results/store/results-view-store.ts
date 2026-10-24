import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ResultsView = "table" | "list" | "json" | "chart";

interface ResultsViewState {
  view: ResultsView;
  setView: (view: ResultsView) => void;
  /** The selected document beside the table, as a tree. */
  preview: boolean;
  togglePreview: () => void;
}

/** How results are shown, remembered across tabs and restarts. */
export const useResultsView = create<ResultsViewState>()(
  persist(
    (set) => ({
      view: "table",
      setView: (view) => set({ view }),
      preview: false,
      togglePreview: () => set((state) => ({ preview: !state.preview })),
    }),
    { name: "odin-results-view", version: 1 },
  ),
);
