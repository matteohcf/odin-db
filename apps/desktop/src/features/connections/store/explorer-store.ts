import { create } from "zustand";

/** Expanded tree nodes, keyed by `profileId` or `profileId/database`. */
interface ExplorerState {
  expanded: ReadonlySet<string>;
  setExpanded: (key: string, expanded: boolean) => void;
  collapseAll: () => void;
  /** Narrows the tree to databases and collections whose name contains it. */
  filter: string;
  setFilter: (filter: string) => void;
  /** A collection row the tree should scroll to, once its catalog is loaded. */
  revealing: string | null;
  reveal: (profileId: string, database: string, collection: string) => void;
  revealed: () => void;
}

export const useExplorer = create<ExplorerState>()((set) => ({
  expanded: new Set(),
  setExpanded: (key, expanded) =>
    set((state) => {
      const next = new Set(state.expanded);
      if (expanded) next.add(key);
      else next.delete(key);
      return { expanded: next };
    }),
  collapseAll: () => set({ expanded: new Set() }),
  filter: "",
  setFilter: (filter) => set({ filter }),
  revealing: null,
  reveal: (profileId, database, collection) =>
    set((state) => ({
      expanded: new Set(state.expanded).add(profileId).add(`${profileId}/${database}`),
      // A filter could hide the row.
      filter: "",
      revealing: `${profileId}/${database}/${collection}`,
    })),
  revealed: () => set({ revealing: null }),
}));

export function useExpanded(key: string) {
  const expanded = useExplorer((s) => s.expanded.has(key));
  const setExpanded = useExplorer((s) => s.setExpanded);
  return [expanded, (value: boolean) => setExpanded(key, value)] as const;
}

/** The filter as compared: trimmed and case-insensitive; empty when not filtering. */
export function useTreeFilter() {
  return useExplorer((s) => s.filter.trim().toLowerCase());
}
