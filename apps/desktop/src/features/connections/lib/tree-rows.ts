import type {
  CollectionInfo,
  ConnectionInfo,
  ConnectionProfile,
  DatabaseInfo,
} from "@odin-db/bindings";

/** What the sidebar shows, one entry per row, so it can render only the visible ones. */
export type TreeItem =
  | { kind: "profile"; key: string; profile: ConnectionProfile }
  | {
      kind: "database";
      key: string;
      connection: ConnectionInfo;
      database: DatabaseInfo;
      open: boolean;
      loading: boolean;
    }
  | {
      kind: "collection";
      key: string;
      connection: ConnectionInfo;
      database: string;
      collection: CollectionInfo;
    }
  | { kind: "message"; key: string; depth: number; message: TreeMessageKind };

type TreeMessageKind =
  | { type: "loading" | "noDatabases" | "noCollections" }
  | { type: "failed"; error: string };

interface Loaded<T> {
  data: T | undefined;
  error: Error | null;
}

export interface TreeInput {
  profiles: readonly ConnectionProfile[];
  connectionOf: (profile: ConnectionProfile) => ConnectionInfo | undefined;
  expanded: ReadonlySet<string>;
  /** Trimmed and lowercase; empty when not filtering. */
  filter: string;
  databases: (connection: ConnectionInfo) => Loaded<DatabaseInfo[]>;
  collections: (connection: ConnectionInfo, database: string) => Loaded<CollectionInfo[]>;
}

// Natural order: tenant_2 before tenant_10.
const collator = new Intl.Collator(undefined, { numeric: true });
const byName = (a: { name: string }, b: { name: string }) => collator.compare(a.name, b.name);

/** Databases MongoDB manages itself; core refuses to drop them too. */
export const SYSTEM_DATABASES = new Set(["admin", "local", "config"]);

export function isSystem(collection: CollectionInfo) {
  return collection.name.startsWith("system.");
}

/** The connections whose databases are listed: open, and expanded or searched. */
export function listedConnections(input: Omit<TreeInput, "databases" | "collections">) {
  return input.profiles.flatMap((profile) => {
    const connection = input.connectionOf(profile);
    return connection && (input.filter || input.expanded.has(profile.id)) ? [connection] : [];
  });
}

/** Databases whose collections are listed: expanded, or every one while filtering. */
export function listsCollections(
  input: Pick<TreeInput, "expanded" | "filter">,
  connection: ConnectionInfo,
  database: string,
) {
  return input.filter !== "" || input.expanded.has(`${connection.profileId}/${database}`);
}

/**
 * Flattens profiles, databases and collections into rows. A filter keeps connections
 * whose name matches, databases whose name matches (with all their collections) and the
 * matching collections of the others.
 */
export function buildTreeRows(input: TreeInput): TreeItem[] {
  const { filter } = input;
  const rows: TreeItem[] = [];
  for (const profile of input.profiles) {
    const connection = input.connectionOf(profile);
    const children =
      connection && (filter || input.expanded.has(profile.id))
        ? catalogRows(input, profile, connection)
        : [];
    if (filter && !profile.name.toLowerCase().includes(filter) && children.length === 0) {
      continue;
    }
    rows.push({ kind: "profile", key: profile.id, profile }, ...children);
  }
  return rows;
}

function catalogRows(
  input: TreeInput,
  profile: ConnectionProfile,
  connection: ConnectionInfo,
): TreeItem[] {
  const { filter } = input;
  const rows: TreeItem[] = [];
  const message = (key: string, depth: number, kind: TreeMessageKind) =>
    rows.push({ kind: "message", key: `${profile.id}/${key}`, depth, message: kind });

  const databases = input.databases(connection);
  if (databases.error) {
    message(":failed", 1, { type: "failed", error: databases.error.message });
    return rows;
  }
  if (!databases.data) {
    message(":loading", 1, { type: "loading" });
    return rows;
  }
  // While filtering, an empty server simply has nothing that matches.
  if (databases.data.length === 0) {
    if (!filter) message(":empty", 1, { type: "noDatabases" });
    return rows;
  }
  for (const database of [...databases.data].sort(byName)) {
    const key = `${profile.id}/${database.name}`;
    const nameMatches = filter !== "" && database.name.toLowerCase().includes(filter);
    const collections = input.collections(connection, database.name);
    const searched = filter !== "" && !nameMatches;
    const shown = searched
      ? collections.data?.filter((collection) => collection.name.toLowerCase().includes(filter))
      : collections.data;
    if (searched && !shown?.length) continue;
    const open = searched || input.expanded.has(key);
    const loading = open && !collections.data && !collections.error;
    rows.push({ kind: "database", key, connection, database, open, loading });
    if (!open || loading) continue;
    if (collections.error) {
      message(`${database.name}:failed`, 2, { type: "failed", error: collections.error.message });
    } else if (collections.data?.length === 0) {
      message(`${database.name}:empty`, 2, { type: "noCollections" });
    } else {
      // Internal `system.*` collections stay visible but out of the way.
      const ordered = [...(shown ?? [])].sort(
        (a, b) => Number(isSystem(a)) - Number(isSystem(b)) || byName(a, b),
      );
      for (const collection of ordered) {
        rows.push({
          kind: "collection",
          key: `${key}/${collection.name}`,
          connection,
          database: database.name,
          collection,
        });
      }
    }
  }
  return rows;
}
