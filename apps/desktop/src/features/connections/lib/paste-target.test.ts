import type { ConnectionInfo, ConnectionProfile } from "@odin-db/bindings";
import { describe, expect, it } from "vitest";
import { pasteTargetOf } from "./paste-target";

const connection = { id: "c1", profileId: "p1" } as ConnectionInfo;
const other = { id: "c2", profileId: "p2" } as ConnectionInfo;
const copied = { connection, database: "shop", collection: "orders" };

describe("pasteTargetOf", () => {
  it("pastes into the database of the row, or the source's name on a server", () => {
    const database = { kind: "database", connection: other, database: { name: "archive" } };
    expect(pasteTargetOf(database as never, copied, [])).toEqual({
      connectionId: "c2",
      database: "archive",
    });
    const collection = { kind: "collection", connection, database: "shop", collection: {} };
    expect(pasteTargetOf(collection as never, copied, [])).toEqual({
      connectionId: "c1",
      database: "shop",
    });
    const profile = { kind: "profile", profile: { id: "p2" } as ConnectionProfile };
    expect(pasteTargetOf(profile as never, copied, [connection, other])).toEqual({
      connectionId: "c2",
      database: "shop",
    });
  });

  it("has no target without a copy, on a closed server, or on a group", () => {
    const database = { kind: "database", connection, database: { name: "shop" } };
    expect(pasteTargetOf(database as never, null, [])).toBeUndefined();
    const closed = { kind: "profile", profile: { id: "p3" } };
    expect(pasteTargetOf(closed as never, copied, [connection])).toBeUndefined();
    expect(pasteTargetOf({ kind: "group" } as never, copied, [])).toBeUndefined();
  });
});
