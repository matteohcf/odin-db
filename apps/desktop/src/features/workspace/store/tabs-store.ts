import type { CollectionKind, ProfileId } from "@odin-db/bindings";
import { create } from "zustand";

/** A tab bound to a collection. New tab kinds (aggregation, shell…) join this union. */
export interface CollectionTab {
  kind: "collection";
  id: string;
  profileId: ProfileId;
  database: string;
  collection: string;
  /** Views are read-only in MongoDB, so the tab must know what it shows. */
  collectionKind: CollectionKind;
}

/** A mongosh session for a profile. Several can be open at once. */
export interface ShellTab {
  kind: "shell";
  id: string;
  profileId: ProfileId;
}

export type WorkspaceTab = CollectionTab | ShellTab;

interface TabsState {
  tabs: WorkspaceTab[];
  activeTabId: string | null;
  openCollection: (target: Omit<CollectionTab, "kind" | "id">) => void;
  openShell: (profileId: ProfileId) => void;
  activate: (id: string) => void;
  close: (id: string) => void;
  closeForProfile: (profileId: ProfileId) => void;
}

/** Remaining tab to focus after `closedIds` disappear: the neighbour of the active one. */
function nextActive(state: TabsState, remaining: WorkspaceTab[]): string | null {
  if (remaining.some((tab) => tab.id === state.activeTabId)) return state.activeTabId;
  const index = state.tabs.findIndex((tab) => tab.id === state.activeTabId);
  return remaining[Math.min(Math.max(index, 0), remaining.length - 1)]?.id ?? null;
}

export const useTabs = create<TabsState>()((set) => ({
  tabs: [],
  activeTabId: null,
  openCollection: (target) =>
    set((state) => {
      // One tab per collection: opening it again focuses the existing tab.
      const id = `${target.profileId}/${target.database}/${target.collection}`;
      if (state.tabs.some((tab) => tab.id === id)) return { activeTabId: id };
      return { tabs: [...state.tabs, { kind: "collection", id, ...target }], activeTabId: id };
    }),
  openShell: (profileId) =>
    set((state) => {
      const id = `shell:${crypto.randomUUID()}`;
      return { tabs: [...state.tabs, { kind: "shell", id, profileId }], activeTabId: id };
    }),
  activate: (id) => set({ activeTabId: id }),
  close: (id) =>
    set((state) => {
      const tabs = state.tabs.filter((tab) => tab.id !== id);
      return { tabs, activeTabId: nextActive(state, tabs) };
    }),
  closeForProfile: (profileId) =>
    set((state) => {
      const tabs = state.tabs.filter((tab) => tab.profileId !== profileId);
      return { tabs, activeTabId: nextActive(state, tabs) };
    }),
}));
