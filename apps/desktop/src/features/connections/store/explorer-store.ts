import { create } from "zustand";

/** Expanded tree nodes, keyed by `profileId` or `profileId/database`. */
interface ExplorerState {
  expanded: ReadonlySet<string>;
  setExpanded: (key: string, expanded: boolean) => void;
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
}));

export function useExpanded(key: string) {
  const expanded = useExplorer((s) => s.expanded.has(key));
  const setExpanded = useExplorer((s) => s.setExpanded);
  return [expanded, (value: boolean) => setExpanded(key, value)] as const;
}
