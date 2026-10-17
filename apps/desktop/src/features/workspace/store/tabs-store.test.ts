import { beforeEach, describe, expect, it } from "vitest";
import { useTabs } from "./tabs-store";

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
    expect(tabs.map((tab) => tab.collection)).toEqual(["users", "orders"]);
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

  it("closes every tab of a profile", () => {
    const { openCollection } = useTabs.getState();
    openCollection(target("a", "p1"));
    openCollection(target("b", "p2"));
    useTabs.getState().closeForProfile("p1");
    expect(useTabs.getState().tabs.map((tab) => tab.profileId)).toEqual(["p2"]);
    expect(useTabs.getState().activeTabId).toBe("p2/shop/b");
  });
});
