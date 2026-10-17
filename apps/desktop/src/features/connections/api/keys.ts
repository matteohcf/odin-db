import type { ConnectionId } from "@odin-db/bindings";

export const connectionKeys = {
  profiles: ["profiles"] as const,
  connections: ["connections"] as const,
  connection: (connectionId: ConnectionId) => ["connections", connectionId] as const,
  databases: (connectionId: ConnectionId) => ["connections", connectionId, "databases"] as const,
  collections: (connectionId: ConnectionId, database: string) =>
    ["connections", connectionId, "databases", database, "collections"] as const,
};
