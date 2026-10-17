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

/** Backup history and schedules of every connection; at most one is open. */
interface BackupsTab {
  kind: "backups";
  id: "backups";
}

/** App settings; at most one is open. */
interface SettingsTab {
  kind: "settings";
  id: "settings";
}

export type WorkspaceTab = CollectionTab | ShellTab | BackupsTab | SettingsTab;

interface TabsState {
  tabs: WorkspaceTab[];
  activeTabId: string | null;
  openCollection: (target: Omit<CollectionTab, "kind" | "id">) => void;
  openShell: (profileId: ProfileId) => void;
  openBackups: () => void;
  openSettings: () => void;
  activate: (id: string) => void;
  close: (id: string) => void;
  closeOthers: (id: string) => void;
  closeToTheRight: (id: string) => void;
  closeAll: () => void;
  closeForProfile: (profileId: ProfileId) => void;
  /** Closes the tabs of a dropped collection, or of every collection of a dropped database. */
  closeCollections: (profileId: ProfileId, database: string, collection?: string) => void;
  /** Keeps open tabs pointing at a renamed collection. */
  renameCollection: (profileId: ProfileId, database: string, from: string, to: string) => void;
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
      const id = collectionTabId(target.profileId, target.database, target.collection);
      if (state.tabs.some((tab) => tab.id === id)) return { activeTabId: id };
      return { tabs: [...state.tabs, { kind: "collection", id, ...target }], activeTabId: id };
    }),
  openShell: (profileId) =>
    set((state) => {
      const id = `shell:${crypto.randomUUID()}`;
      return { tabs: [...state.tabs, { kind: "shell", id, profileId }], activeTabId: id };
    }),
  openBackups: () =>
    set((state) =>
      state.tabs.some((tab) => tab.id === "backups")
        ? { activeTabId: "backups" }
        : { tabs: [...state.tabs, { kind: "backups", id: "backups" }], activeTabId: "backups" },
    ),
  openSettings: () =>
    set((state) =>
      state.tabs.some((tab) => tab.id === "settings")
        ? { activeTabId: "settings" }
        : { tabs: [...state.tabs, { kind: "settings", id: "settings" }], activeTabId: "settings" },
    ),
  activate: (id) => set({ activeTabId: id }),
  close: (id) =>
    set((state) => {
      const tabs = state.tabs.filter((tab) => tab.id !== id);
      return { tabs, activeTabId: nextActive(state, tabs) };
    }),
  closeOthers: (id) =>
    set((state) => ({ tabs: state.tabs.filter((tab) => tab.id === id), activeTabId: id })),
  closeToTheRight: (id) =>
    set((state) => {
      const index = state.tabs.findIndex((tab) => tab.id === id);
      const tabs = state.tabs.slice(0, index + 1);
      return { tabs, activeTabId: nextActive(state, tabs) };
    }),
  closeAll: () => set({ tabs: [], activeTabId: null }),
  closeForProfile: (profileId) =>
    set((state) => {
      const tabs = state.tabs.filter((tab) => !("profileId" in tab) || tab.profileId !== profileId);
      return { tabs, activeTabId: nextActive(state, tabs) };
    }),
  closeCollections: (profileId, database, collection) =>
    set((state) => {
      const tabs = state.tabs.filter(
        (tab) =>
          !(
            tab.kind === "collection" &&
            tab.profileId === profileId &&
            tab.database === database &&
            (collection === undefined || tab.collection === collection)
          ),
      );
      return { tabs, activeTabId: nextActive(state, tabs) };
    }),
  renameCollection: (profileId, database, from, to) =>
    set((state) => {
      const oldId = collectionTabId(profileId, database, from);
      const newId = collectionTabId(profileId, database, to);
      return {
        tabs: state.tabs.map((tab) =>
          tab.id === oldId && tab.kind === "collection"
            ? { ...tab, id: newId, collection: to }
            : tab,
        ),
        activeTabId: state.activeTabId === oldId ? newId : state.activeTabId,
      };
    }),
}));

function collectionTabId(profileId: ProfileId, database: string, collection: string) {
  return `${profileId}/${database}/${collection}`;
}
