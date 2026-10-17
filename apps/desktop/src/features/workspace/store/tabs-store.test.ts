import { beforeEach, describe, expect, it } from "vitest";
import { restorableTabs, useTabs } from "./tabs-store";

const target = (collection: string, profileId = "p1") => ({
  profileId,
  database: "shop",
  collection,
  collectionKind: "collection" as const,
});

describe("tabs store", () => {
  beforeEach(() =>
    useTabs.setState({ tabs: [], activeTabId: null, pinned: [], closed: [], recent: [] }),
  );

  it("opens one tab per collection and focuses existing ones", () => {
    const { openCollection } = useTabs.getState();
    openCollection(target("users"));
    openCollection(target("orders"));
    openCollection(target("users"));
    const { tabs, activeTabId } = useTabs.getState();
    expect(tabs.map((tab) => (tab.kind === "collection" ? tab.collection : tab.kind))).toEqual([
      "users",
      "orders",
    ]);
    expect(activeTabId).toBe("p1/shop/users");
  });

  it("focuses the neighbour when the active tab closes", () => {
    const { openCollection } = useTabs.getState();
    for (const name of ["a", "b", "c"]) openCollection(target(name));
    useTabs.getState().activate("p1/shop/b");
    useTabs.getState().close("p1/shop/b");
    expect(useTabs.getState().activeTabId).toBe("p1/shop/c");
    useTabs.getState().close("p1/shop/c");
    expect(useTabs.getState().activeTabId).toBe("p1/shop/a");
    useTabs.getState().close("p1/shop/a");
    expect(useTabs.getState().activeTabId).toBeNull();
  });

  it("opens a new shell tab every time", () => {
    useTabs.getState().openShell("p1");
    useTabs.getState().openShell("p1");
    const { tabs, activeTabId } = useTabs.getState();
    expect(tabs.map((tab) => tab.kind)).toEqual(["shell", "shell"]);
    expect(activeTabId).toBe(tabs[1]?.id);
  });

  it("closes every tab of a profile", () => {
    const { openCollection } = useTabs.getState();
    openCollection(target("a", "p1"));
    openCollection(target("b", "p2"));
    useTabs.getState().closeForProfile("p1");
    expect(useTabs.getState().tabs.map((tab) => tab.id)).toEqual(["p2/shop/b"]);
    expect(useTabs.getState().activeTabId).toBe("p2/shop/b");
  });

  it("closes the tabs of a dropped collection or database", () => {
    const { openCollection } = useTabs.getState();
    openCollection(target("users"));
    openCollection(target("orders"));
    openCollection({ ...target("logs"), database: "analytics" });
    useTabs.getState().closeCollections("p1", "shop", "users");
    expect(useTabs.getState().tabs.map((tab) => tab.id)).toEqual([
      "p1/shop/orders",
      "p1/analytics/logs",
    ]);
    useTabs.getState().closeCollections("p1", "shop");
    expect(useTabs.getState().tabs.map((tab) => tab.id)).toEqual(["p1/analytics/logs"]);
  });

  it("follows a renamed collection", () => {
    useTabs.getState().openCollection(target("orders"));
    useTabs.getState().renameCollection("p1", "shop", "orders", "orders_2026");
    const { tabs, activeTabId } = useTabs.getState();
    expect(activeTabId).toBe("p1/shop/orders_2026");
    expect(tabs[0]).toMatchObject({ id: "p1/shop/orders_2026", collection: "orders_2026" });
  });

  it("duplicates a collection tab next to it, and renames duplicates too", () => {
    const { openCollection, duplicate } = useTabs.getState();
    openCollection(target("users"));
    openCollection(target("orders"));
    duplicate("p1/shop/users");
    const { tabs, activeTabId } = useTabs.getState();
    expect(tabs.map((tab) => (tab.kind === "collection" ? tab.collection : ""))).toEqual([
      "users",
      "users",
      "orders",
    ]);
    expect(activeTabId).toMatch(/^p1\/shop\/users#/);
    useTabs.getState().renameCollection("p1", "shop", "users", "people");
    const renamed = useTabs.getState();
    expect(renamed.tabs.map((tab) => tab.id.split("#")[0])).toEqual([
      "p1/shop/people",
      "p1/shop/people",
      "p1/shop/orders",
    ]);
    expect(renamed.activeTabId).toMatch(/^p1\/shop\/people#/);
    // Opening the collection again focuses the original tab.
    useTabs.getState().openCollection(target("people"));
    expect(useTabs.getState().activeTabId).toBe("p1/shop/people");
  });

  it("opens another tab on request, the first open just focusing one", () => {
    const { openCollection } = useTabs.getState();
    openCollection(target("users"), true);
    openCollection(target("users"), true);
    openCollection(target("users"));
    const { tabs, activeTabId } = useTabs.getState();
    expect(tabs).toHaveLength(2);
    expect(tabs[0]?.id).toBe("p1/shop/users");
    expect(activeTabId).toBe("p1/shop/users");
  });

  it("closes other tabs, tabs to the right, or all", () => {
    const { openCollection } = useTabs.getState();
    for (const name of ["a", "b", "c", "d"]) openCollection(target(name));
    useTabs.getState().activate("p1/shop/d");
    useTabs.getState().closeToTheRight("p1/shop/b");
    expect(useTabs.getState().tabs.map((tab) => tab.id)).toEqual(["p1/shop/a", "p1/shop/b"]);
    expect(useTabs.getState().activeTabId).toBe("p1/shop/b");
    useTabs.getState().closeOthers("p1/shop/a");
    expect(useTabs.getState().tabs.map((tab) => tab.id)).toEqual(["p1/shop/a"]);
    useTabs.getState().closeAll();
    expect(useTabs.getState()).toMatchObject({ tabs: [], activeTabId: null });
  });

  it("keeps a single backups tab, untouched by profile closing", () => {
    useTabs.getState().openBackups();
    useTabs.getState().openCollection(target("a"));
    useTabs.getState().openBackups();
    expect(useTabs.getState().tabs.map((tab) => tab.id)).toEqual(["backups", "p1/shop/a"]);
    expect(useTabs.getState().activeTabId).toBe("backups");
    useTabs.getState().closeForProfile("p1");
    expect(useTabs.getState().tabs.map((tab) => tab.id)).toEqual(["backups"]);
  });

  it("keeps a single settings tab", () => {
    useTabs.getState().openSettings();
    useTabs.getState().openBackups();
    useTabs.getState().openSettings();
    expect(useTabs.getState().tabs.map((tab) => tab.id)).toEqual(["settings", "backups"]);
    expect(useTabs.getState().activeTabId).toBe("settings");
  });

  it("restores every tab but shells after a restart", () => {
    useTabs.getState().openCollection(target("a"));
    useTabs.getState().openSettings();
    useTabs.getState().openShell("p1");
    const restored = restorableTabs(useTabs.getState());
    expect(restored.tabs.map((tab) => tab.id)).toEqual(["p1/shop/a", "settings"]);
    // The active shell is gone: the last restored tab takes over.
    expect(restored.activeTabId).toBe("settings");
    useTabs.getState().activate("p1/shop/a");
    expect(restorableTabs(useTabs.getState()).activeTabId).toBe("p1/shop/a");
  });

  const ids = () => useTabs.getState().tabs.map((tab) => tab.id);

  it("keeps pinned tabs first and spares them from bulk closes", () => {
    for (const name of ["a", "b", "c", "d"]) useTabs.getState().openCollection(target(name));
    useTabs.getState().togglePin("p1/shop/c");
    expect(ids()).toEqual(["p1/shop/c", "p1/shop/a", "p1/shop/b", "p1/shop/d"]);
    useTabs.getState().closeOthers("p1/shop/b");
    expect(ids()).toEqual(["p1/shop/c", "p1/shop/b"]);
    useTabs.getState().closeAll();
    expect(ids()).toEqual(["p1/shop/c"]);
    useTabs.getState().togglePin("p1/shop/c");
    useTabs.getState().closeAll();
    expect(ids()).toEqual([]);
  });

  it("moves tabs only within their group", () => {
    for (const name of ["a", "b", "c"]) useTabs.getState().openCollection(target(name));
    useTabs.getState().togglePin("p1/shop/b");
    useTabs.getState().move("p1/shop/c", 0);
    expect(ids()).toEqual(["p1/shop/b", "p1/shop/c", "p1/shop/a"]);
    useTabs.getState().move("p1/shop/b", 5);
    expect(ids()).toEqual(["p1/shop/b", "p1/shop/c", "p1/shop/a"]);
  });

  it("reopens closed tabs, newest first", () => {
    for (const name of ["a", "b", "c"]) useTabs.getState().openCollection(target(name));
    useTabs.getState().close("p1/shop/b");
    useTabs.getState().close("p1/shop/c");
    useTabs.getState().reopenClosed();
    expect(ids()).toEqual(["p1/shop/a", "p1/shop/c"]);
    expect(useTabs.getState().activeTabId).toBe("p1/shop/c");
    useTabs.getState().openCollection(target("b"));
    // b is open again, so there is nothing left to reopen.
    useTabs.getState().reopenClosed();
    expect(ids()).toEqual(["p1/shop/a", "p1/shop/c", "p1/shop/b"]);
  });

  it("does not offer to reopen tabs of dropped collections", () => {
    useTabs.getState().openCollection(target("a"));
    useTabs.getState().closeCollections("p1", "shop", "a");
    useTabs.getState().reopenClosed();
    expect(ids()).toEqual([]);
  });

  it("follows a renamed pinned tab", () => {
    useTabs.getState().openCollection(target("a"));
    useTabs.getState().togglePin("p1/shop/a");
    useTabs.getState().renameCollection("p1", "shop", "a", "z");
    expect(useTabs.getState().pinned).toEqual(["p1/shop/z"]);
  });

  it("keeps one server tab per connection, closed with it", () => {
    useTabs.getState().openServer("p1");
    useTabs.getState().openServer("p2");
    useTabs.getState().openServer("p1");
    expect(ids()).toEqual(["server:p1", "server:p2"]);
    expect(useTabs.getState().activeTabId).toBe("server:p1");
    useTabs.getState().closeForProfile("p1");
    expect(ids()).toEqual(["server:p2"]);
  });

  it("remembers recently opened collections, newest first", () => {
    for (const name of ["a", "b", "a"]) useTabs.getState().openCollection(target(name));
    const recent = () => useTabs.getState().recent.map((r) => r.collection);
    expect(recent()).toEqual(["a", "b"]);
    useTabs.getState().renameCollection("p1", "shop", "b", "z");
    expect(recent()).toEqual(["a", "z"]);
    useTabs.getState().closeCollections("p1", "shop", "a");
    expect(recent()).toEqual(["z"]);
    useTabs.getState().closeForProfile("p1");
    expect(recent()).toEqual([]);
  });
});
