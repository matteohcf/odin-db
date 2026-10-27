import type { ConnectionId, ConnectionInfo } from "@odin-db/bindings";
import { create } from "zustand";

/** A collection or database copied in the tree, to paste on another database. */
export interface CopiedNode {
  connection: ConnectionInfo;
  database: string;
  collection?: string;
}

/** Expanded tree nodes, keyed by `profileId` or `profileId/database`. */
interface ExplorerState {
  expanded: ReadonlySet<string>;
  setExpanded: (key: string, expanded: boolean) => void;
  /** Collapses every node; `collapsed` are inverted keys (open by default) to set. */
  collapseAll: (collapsed?: readonly string[]) => void;
  /** Narrows the tree to databases and collections whose name contains it. */
  filter: string;
  setFilter: (filter: string) => void;
  /** Hides the saved connections that are not open. */
  openOnly: boolean;
  setOpenOnly: (openOnly: boolean) => void;
  /** A collection row the tree should scroll to, once its catalog is loaded. */
  revealing: string | null;
  reveal: (profileId: string, database: string, collection: string) => void;
  revealed: () => void;
  copied: CopiedNode | null;
  copy: (node: CopiedNode) => void;
  /** Where the copied node is being pasted, while the copy dialog is open. */
  pasting: PasteTarget | null;
  paste: (target: PasteTarget | null) => void;
  /** The connection manager: every saved connection, to pick one to connect (ADR-0058). */
  managerOpen: boolean;
  setManagerOpen: (open: boolean) => void;
  /** Set by the mounted sidebar, so screens elsewhere (the welcome page) can start these. */
  commands: ExplorerCommands | null;
  setCommands: (commands: ExplorerCommands | null) => void;
}

interface ExplorerCommands {
  newConnection: () => void;
  importConnections: () => void;
}

export interface PasteTarget {
  connectionId: ConnectionId;
  database: string;
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
  collapseAll: (collapsed = []) => set({ expanded: new Set(collapsed) }),
  filter: "",
  setFilter: (filter) => set({ filter }),
  openOnly: false,
  setOpenOnly: (openOnly) => set({ openOnly }),
  revealing: null,
  reveal: (profileId, database, collection) =>
    set((state) => ({
      expanded: new Set(state.expanded).add(profileId).add(`${profileId}/${database}`),
      // A filter could hide the row.
      filter: "",
      revealing: `${profileId}/${database}/${collection}`,
    })),
  revealed: () => set({ revealing: null }),
  copied: null,
  copy: (copied) => set({ copied }),
  pasting: null,
  paste: (pasting) => set({ pasting }),
  managerOpen: false,
  setManagerOpen: (managerOpen) => set({ managerOpen }),
  commands: null,
  setCommands: (commands) => set({ commands }),
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
