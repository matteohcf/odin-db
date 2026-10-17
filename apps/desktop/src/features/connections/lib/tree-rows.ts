import type {
  CollectionInfo,
  ConnectionInfo,
  ConnectionProfile,
  DatabaseInfo,
} from "@odin-db/bindings";

/** What the sidebar shows, one entry per row, so it can render only the visible ones. */
export type TreeItem =
  | { kind: "group"; key: string; name: string; count: number; collapsed: boolean }
  | { kind: "profile"; key: string; indent: number; profile: ConnectionProfile }
  | {
      kind: "database";
      key: string;
      indent: number;
      connection: ConnectionInfo;
      database: DatabaseInfo;
      open: boolean;
      loading: boolean;
    }
  | {
      kind: "collection";
      key: string;
      indent: number;
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
 * Flattens groups, profiles, databases and collections into rows. A filter keeps groups
 * and connections whose name matches, databases whose name matches (with all their
 * collections) and the matching collections of the others.
 */
export function buildTreeRows(input: TreeInput): TreeItem[] {
  const groups = new Map<string, ConnectionProfile[]>();
  const ungrouped: ConnectionProfile[] = [];
  for (const profile of input.profiles) {
    if (profile.group) groups.set(profile.group, [...(groups.get(profile.group) ?? []), profile]);
    else ungrouped.push(profile);
  }
  const rows: TreeItem[] = [];
  // Folders first, like a file browser.
  for (const name of [...groups.keys()].sort(collator.compare)) {
    const members = groups.get(name) ?? [];
    const nameMatches = input.filter !== "" && name.toLowerCase().includes(input.filter);
    const children = members.flatMap((profile) => profileRows(input, profile, 1, nameMatches));
    if (input.filter && !nameMatches && children.length === 0) continue;
    const collapsed = !input.filter && input.expanded.has(collapsedGroupKey(name));
    rows.push({ kind: "group", key: `group:${name}`, name, count: members.length, collapsed });
    if (!collapsed) rows.push(...children);
  }
  for (const profile of ungrouped) rows.push(...profileRows(input, profile, 0, false));
  return rows;
}

/** Groups start open, so the explorer stores the collapsed ones. */
export const collapsedGroupKey = (name: string) => `collapsed-group:${name}`;

function profileRows(
  input: TreeInput,
  profile: ConnectionProfile,
  indent: number,
  /** The group's name matched the filter: its connections all show. */
  shown: boolean,
): TreeItem[] {
  const { filter } = input;
  const connection = input.connectionOf(profile);
  const children =
    connection && (filter || input.expanded.has(profile.id))
      ? catalogRows(input, profile, connection, indent)
      : [];
  if (filter && !shown && !profile.name.toLowerCase().includes(filter) && !children.length) {
    return [];
  }
  return [{ kind: "profile", key: profile.id, indent, profile }, ...children];
}

function catalogRows(
  input: TreeInput,
  profile: ConnectionProfile,
  connection: ConnectionInfo,
  indent: number,
): TreeItem[] {
  const { filter } = input;
  const rows: TreeItem[] = [];
  const message = (key: string, depth: number, kind: TreeMessageKind) =>
    rows.push({
      kind: "message",
      key: `${profile.id}/${key}`,
      depth: depth + indent,
      message: kind,
    });

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
    rows.push({ kind: "database", key, indent, connection, database, open, loading });
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
          indent,
          connection,
          database: database.name,
          collection,
        });
      }
    }
  }
  return rows;
}
