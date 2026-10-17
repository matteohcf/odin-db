import { beforeEach, describe, expect, it } from "vitest";
import { restorableTabs, useTabs } from "./tabs-store";

const target = (collection: string, profileId = "p1") => ({
  profileId,
  database: "shop",
  collection,
  collectionKind: "collection" as const,
});

describe("tabs store", () => {
  beforeEach(() => useTabs.setState({ tabs: [], activeTabId: null }));

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
});
