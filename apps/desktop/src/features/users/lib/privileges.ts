import type { Privilege, Resource } from "@odin-db/bindings";

/** Privilege actions offered while typing; any other action can still be entered. */
export const PRIVILEGE_ACTIONS = [
  "find",
  "insert",
  "update",
  "remove",
  "bypassDocumentValidation",
  "changeStream",
  "createCollection",
  "createIndex",
  "dropCollection",
  "dropIndex",
  "collMod",
  "collStats",
  "dbStats",
  "indexStats",
  "listCollections",
  "listIndexes",
  "listDatabases",
  "killCursors",
  "killop",
  "inprog",
  "renameCollectionSameDB",
  "convertToCapped",
  "compact",
  "validate",
  "enableProfiler",
  "planCacheRead",
  "serverStatus",
  "replSetGetStatus",
  "top",
  "hostInfo",
  "createUser",
  "dropUser",
  "viewUser",
  "changePassword",
  "changeOwnPassword",
  "createRole",
  "dropRole",
  "viewRole",
  "grantRole",
  "revokeRole",
] as const;

/** A resource in the server's own shorthand: `db.collection`, `*` for every one. */
export function resourceText(resource: Resource): string {
  if (resource.kind !== "namespace") return resource.kind;
  return `${resource.db || "*"}.${resource.collection || "*"}`;
}

/** Privileges as entered, trimmed, with blank actions and action-less rows left out. */
export function cleanPrivileges(privileges: Privilege[]): Privilege[] {
  return privileges
    .map((privilege) => ({
      resource:
        privilege.resource.kind === "namespace"
          ? {
              kind: "namespace" as const,
              db: privilege.resource.db.trim(),
              collection: privilege.resource.collection.trim(),
            }
          : privilege.resource,
      actions: privilege.actions.map((action) => action.trim()).filter(Boolean),
    }))
    .filter((privilege) => privilege.actions.length > 0);
}
