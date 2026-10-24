import type { ConnectionInfo } from "@odin-db/bindings";
import type { CopiedNode, PasteTarget } from "../store/explorer-store";
import type { TreeItem } from "./tree-rows";

/**
 * Where pasting on a tree row puts the copied node: a database or a collection pastes into
 * that database, a connected server into a database named like the source.
 */
export function pasteTargetOf(
  row: TreeItem,
  copied: CopiedNode | null,
  connections: readonly ConnectionInfo[],
): PasteTarget | undefined {
  if (!copied) return undefined;
  switch (row.kind) {
    case "database":
      return { connectionId: row.connection.id, database: row.database.name };
    case "collection":
      return { connectionId: row.connection.id, database: row.database };
    case "profile": {
      const connection = connections.find((candidate) => candidate.profileId === row.profile.id);
      return connection && { connectionId: connection.id, database: copied.database };
    }
    default:
      return undefined;
  }
}
