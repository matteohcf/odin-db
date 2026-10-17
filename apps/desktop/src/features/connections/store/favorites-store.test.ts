import { beforeEach, describe, expect, it } from "vitest";
import { useFavorites } from "./favorites-store";

const favorite = (collection: string, database = "shop", profileId = "p1") => ({
  profileId,
  database,
  collection,
  collectionKind: "collection" as const,
});
const names = () => useFavorites.getState().favorites.map((f) => `${f.database}.${f.collection}`);

describe("favorites store", () => {
  beforeEach(() => useFavorites.setState({ favorites: [] }));

  it("toggles favorites in the order they were added", () => {
    const { toggle } = useFavorites.getState();
    toggle(favorite("orders"));
    toggle(favorite("users"));
    toggle(favorite("orders"));
    toggle(favorite("orders"));
    expect(names()).toEqual(["shop.users", "shop.orders"]);
  });

  it("follows renames and forgets dropped collections, databases and profiles", () => {
    const { toggle } = useFavorites.getState();
    toggle(favorite("orders"));
    toggle(favorite("users"));
    toggle(favorite("events", "analytics"));
    toggle(favorite("logs", "analytics", "p2"));
    useFavorites.getState().rename("p1", "shop", "orders", "sales");
    expect(names()).toContain("shop.sales");
    useFavorites.getState().forget("p1", "shop", "users");
    useFavorites.getState().forget("p1", "analytics");
    expect(names()).toEqual(["shop.sales", "analytics.logs"]);
    useFavorites.getState().forgetProfile("p2");
    expect(names()).toEqual(["shop.sales"]);
  });
});
