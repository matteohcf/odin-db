import { create } from "zustand";

export interface Metric {
  label: string;
  value: string;
  budget?: string;
  pass?: boolean;
}

interface BenchResult {
  id: string;
  metrics: Metric[];
}

interface BenchResultsState {
  results: Record<string, BenchResult>;
  record: (result: BenchResult) => void;
  clear: () => void;
}

export const useBenchResults = create<BenchResultsState>()((set) => ({
  results: {},
  record: (result) => set((state) => ({ results: { ...state.results, [result.id]: result } })),
  clear: () => set({ results: {} }),
}));
