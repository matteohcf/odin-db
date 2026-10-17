import type { CollectionKind, ProfileId } from "@odin-db/bindings";
import { create } from "zustand";
import { persist } from "zustand/middleware";

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

/** Live status and running operations of a server; one per connection. */
export interface ServerTab {
  kind: "server";
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

export type WorkspaceTab = CollectionTab | ShellTab | ServerTab | BackupsTab | SettingsTab;

export type RecentCollection = Omit<CollectionTab, "kind" | "id">;

const MAX_RECENT = 8;

const sameCollection = (a: RecentCollection, b: RecentCollection) =>
  a.profileId === b.profileId && a.database === b.database && a.collection === b.collection;

interface TabsState {
  /** Display order; pinned tabs always come first. */
  tabs: WorkspaceTab[];
  activeTabId: string | null;
  pinned: string[];
  /** Recently closed tabs, newest last, for reopening. Not persisted. */
  closed: WorkspaceTab[];
  /** Collections opened lately, newest first, shown on the start screen. */
  recent: RecentCollection[];
  openCollection: (target: Omit<CollectionTab, "kind" | "id">) => void;
  openShell: (profileId: ProfileId) => void;
  openServer: (profileId: ProfileId) => void;
  openBackups: () => void;
  openSettings: () => void;
  activate: (id: string) => void;
  /** Pinned tabs stay at the left and survive "close others" and "close all". */
  togglePin: (id: string) => void;
  /** Moves a tab to `index`, within its group (pinned or not). */
  move: (id: string, index: number) => void;
  reopenClosed: () => void;
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

const MAX_CLOSED = 20;

/**
 * Keeps the tabs `keep` accepts. `remember` puts the others on the reopen stack:
 * true for closes the user asked for, not for tabs whose collection is gone.
 */
function keepTabs(
  state: TabsState,
  keep: (tab: WorkspaceTab) => boolean,
  remember: boolean,
): Partial<TabsState> {
  const tabs = state.tabs.filter(keep);
  const gone = state.tabs.filter((tab) => !keep(tab));
  return {
    tabs,
    activeTabId: nextActive(state, tabs),
    pinned: state.pinned.filter((id) => tabs.some((tab) => tab.id === id)),
    closed: remember ? [...state.closed, ...gone].slice(-MAX_CLOSED) : state.closed,
  };
}

/** Remaining tab to focus after `closedIds` disappear: the neighbour of the active one. */
function nextActive(state: TabsState, remaining: WorkspaceTab[]): string | null {
  if (remaining.some((tab) => tab.id === state.activeTabId)) return state.activeTabId;
  const index = state.tabs.findIndex((tab) => tab.id === state.activeTabId);
  return remaining[Math.min(Math.max(index, 0), remaining.length - 1)]?.id ?? null;
}

/**
 * What survives a restart: every tab but shells, whose sessions end with the app.
 * Collection tabs come back disconnected and offer to reconnect.
 */
export function restorableTabs(
  state: Pick<TabsState, "tabs" | "activeTabId" | "pinned" | "recent">,
) {
  const tabs = state.tabs.filter((tab) => tab.kind !== "shell");
  const activeTabId = tabs.some((tab) => tab.id === state.activeTabId)
    ? state.activeTabId
    : (tabs.at(-1)?.id ?? null);
  const pinned = state.pinned.filter((id) => tabs.some((tab) => tab.id === id));
  return { tabs, activeTabId, pinned, recent: state.recent };
}

export const useTabs = create<TabsState>()(
  persist(
    (set) => ({
      tabs: [],
      activeTabId: null,
      pinned: [],
      closed: [],
      recent: [],
      openCollection: (target) =>
        set((state) => {
          // One tab per collection: opening it again focuses the existing tab.
          const id = collectionTabId(target.profileId, target.database, target.collection);
          const recent = [target, ...state.recent.filter((r) => !sameCollection(r, target))].slice(
            0,
            MAX_RECENT,
          );
          if (state.tabs.some((tab) => tab.id === id)) return { activeTabId: id, recent };
          return {
            tabs: [...state.tabs, { kind: "collection", id, ...target }],
            activeTabId: id,
            recent,
          };
        }),
      openShell: (profileId) =>
        set((state) => {
          const id = `shell:${crypto.randomUUID()}`;
          return { tabs: [...state.tabs, { kind: "shell", id, profileId }], activeTabId: id };
        }),
      openServer: (profileId) =>
        set((state) => {
          const id = `server:${profileId}`;
          if (state.tabs.some((tab) => tab.id === id)) return { activeTabId: id };
          return { tabs: [...state.tabs, { kind: "server", id, profileId }], activeTabId: id };
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
            : {
                tabs: [...state.tabs, { kind: "settings", id: "settings" }],
                activeTabId: "settings",
              },
        ),
      activate: (id) => set({ activeTabId: id }),
      togglePin: (id) =>
        set((state) => {
          if (!state.tabs.some((tab) => tab.id === id)) return {};
          const pinned = state.pinned.includes(id)
            ? state.pinned.filter((other) => other !== id)
            : [...state.pinned, id];
          // Pinned tabs first, in pin order; then the rest in their current order.
          const tabs = [
            ...pinned.flatMap((other) => state.tabs.filter((tab) => tab.id === other)),
            ...state.tabs.filter((tab) => !pinned.includes(tab.id)),
          ];
          return { tabs, pinned };
        }),
      move: (id, index) =>
        set((state) => {
          const from = state.tabs.findIndex((tab) => tab.id === id);
          if (from < 0) return {};
          const pinnedCount = state.pinned.length;
          const [low, high] = state.pinned.includes(id)
            ? [0, pinnedCount - 1]
            : [pinnedCount, state.tabs.length - 1];
          const to = Math.min(Math.max(index, low), high);
          const tabs = [...state.tabs];
          const [tab] = tabs.splice(from, 1);
          if (!tab) return {};
          tabs.splice(to, 0, tab);
          const pinned = tabs.filter((t) => state.pinned.includes(t.id)).map((t) => t.id);
          return { tabs, pinned };
        }),
      reopenClosed: () =>
        set((state) => {
          const closed = [...state.closed];
          let tab = closed.pop();
          // Skip tabs reopened meanwhile by other means.
          while (tab && state.tabs.some((open) => open.id === tab?.id)) tab = closed.pop();
          if (!tab) return { closed };
          return { tabs: [...state.tabs, tab], activeTabId: tab.id, closed };
        }),
      close: (id) => set((state) => keepTabs(state, (tab) => tab.id !== id, true)),
      closeOthers: (id) =>
        set((state) => ({
          ...keepTabs(state, (tab) => tab.id === id || state.pinned.includes(tab.id), true),
          activeTabId: id,
        })),
      closeToTheRight: (id) =>
        set((state) => {
          const index = state.tabs.findIndex((tab) => tab.id === id);
          const kept = new Set(state.tabs.slice(0, index + 1).map((tab) => tab.id));
          return keepTabs(state, (tab) => kept.has(tab.id) || state.pinned.includes(tab.id), true);
        }),
      closeAll: () => set((state) => keepTabs(state, (tab) => state.pinned.includes(tab.id), true)),
      closeForProfile: (profileId) =>
        set((state) => ({
          ...keepTabs(state, (tab) => !("profileId" in tab) || tab.profileId !== profileId, false),
          recent: state.recent.filter((r) => r.profileId !== profileId),
        })),
      closeCollections: (profileId, database, collection) =>
        set((state) => ({
          recent: state.recent.filter(
            (r) =>
              !(
                r.profileId === profileId &&
                r.database === database &&
                (collection === undefined || r.collection === collection)
              ),
          ),
          ...keepTabs(
            state,
            (tab) =>
              !(
                tab.kind === "collection" &&
                tab.profileId === profileId &&
                tab.database === database &&
                (collection === undefined || tab.collection === collection)
              ),
            false,
          ),
        })),
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
            pinned: state.pinned.map((pinnedId) => (pinnedId === oldId ? newId : pinnedId)),
            recent: state.recent.map((r) =>
              sameCollection(r, { ...r, profileId, database, collection: from })
                ? { ...r, collection: to }
                : r,
            ),
          };
        }),
    }),
    { name: "odin-tabs", version: 1, partialize: (state) => restorableTabs(state) },
  ),
);

function collectionTabId(profileId: ProfileId, database: string, collection: string) {
  return `${profileId}/${database}/${collection}`;
}
