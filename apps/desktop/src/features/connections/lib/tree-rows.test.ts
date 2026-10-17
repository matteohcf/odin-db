import type {
  CollectionInfo,
  ConnectionInfo,
  ConnectionProfile,
  DatabaseInfo,
} from "@odin-db/bindings";
import { describe, expect, it } from "vitest";
import { buildTreeRows, type TreeInput } from "./tree-rows";

const profile = { id: "p1", name: "Local" } as ConnectionProfile;
const connection = { id: "c1", profileId: "p1" } as ConnectionInfo;
const db = (name: string) => ({ name, empty: false, sizeOnDisk: 0 }) as DatabaseInfo;
const coll = (name: string) => ({ name, kind: "collection" }) as CollectionInfo;
const catalog: Record<string, string[]> = {
  shop: ["users", "orders", "system.views"],
  tenant_10: ["invoices"],
  tenant_2: ["users_10", "users_2"],
};

function rows(overrides: Partial<TreeInput> = {}) {
  return buildTreeRows({
    profiles: [profile],
    connectionOf: () => connection,
    expanded: new Set(["p1"]),
    filter: "",
    databases: () => ({ data: Object.keys(catalog).map(db), error: null }),
    collections: (_, name) => ({ data: catalog[name]?.map(coll), error: null }),
    ...overrides,
  }).map((row) => (row.kind === "message" ? `${row.depth}:${row.message.type}` : row.key));
}

describe("buildTreeRows", () => {
  it("lists databases in natural order under an expanded profile", () => {
    expect(rows()).toEqual(["p1", "p1/shop", "p1/tenant_2", "p1/tenant_10"]);
  });

  it("lists an expanded database's collections, system ones last", () => {
    expect(rows({ expanded: new Set(["p1", "p1/shop"]) })).toEqual([
      "p1",
      "p1/shop",
      "p1/shop/orders",
      "p1/shop/users",
      "p1/shop/system.views",
      "p1/tenant_2",
      "p1/tenant_10",
    ]);
  });

  it("hides the databases of a collapsed or closed profile", () => {
    expect(rows({ expanded: new Set() })).toEqual(["p1"]);
    expect(rows({ connectionOf: () => undefined })).toEqual(["p1"]);
  });

  it("filters across collapsed databases, keeping whole databases whose name matches", () => {
    expect(rows({ expanded: new Set(), filter: "users" })).toEqual([
      "p1",
      "p1/shop",
      "p1/shop/users",
      "p1/tenant_2",
      "p1/tenant_2/users_2",
      "p1/tenant_2/users_10",
    ]);
    expect(rows({ expanded: new Set(), filter: "tenant_1" })).toEqual(["p1", "p1/tenant_10"]);
  });

  it("filters connections by name too", () => {
    const other = { id: "p2", name: "Production" } as ConnectionProfile;
    const both = {
      profiles: [profile, other],
      connectionOf: (p: ConnectionProfile) => (p.id === "p1" ? connection : undefined),
    };
    expect(rows({ ...both, filter: "prod" })).toEqual(["p2"]);
    expect(rows({ ...both, filter: "users" })).toEqual([
      "p1",
      "p1/shop",
      "p1/shop/users",
      "p1/tenant_2",
      "p1/tenant_2/users_2",
      "p1/tenant_2/users_10",
    ]);
    expect(rows({ ...both, filter: "nothing" })).toEqual([]);
  });

  it("shows loading, empty and failed states", () => {
    expect(rows({ databases: () => ({ data: undefined, error: null }) })).toEqual([
      "p1",
      "1:loading",
    ]);
    expect(rows({ databases: () => ({ data: [], error: null }) })).toEqual(["p1", "1:noDatabases"]);
    expect(
      rows({
        expanded: new Set(["p1", "p1/shop"]),
        databases: () => ({ data: [db("shop")], error: null }),
        collections: () => ({ data: undefined, error: new Error("denied") }),
      }),
    ).toEqual(["p1", "p1/shop", "2:failed"]);
  });
});
