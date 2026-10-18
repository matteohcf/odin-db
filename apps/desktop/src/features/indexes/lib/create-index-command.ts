import type { IndexInfo, JsonValue } from "@odin-db/bindings";
import type { JsonObject } from "@/lib/ejson-display";
import { toShellSyntax } from "@/lib/shell-syntax";

/** The mongosh command that recreates the index elsewhere, with every option it has. */
export function createIndexCommand(collection: string, index: IndexInfo): string {
  // Server bookkeeping, not options: the version, the keys (passed first) and the namespace.
  const { v: _v, key: _key, ns: _ns, ...options } = index.definition as JsonObject;
  const target = `db.getCollection(${JSON.stringify(collection)})`;
  return `${target}.createIndex(${toShellSyntax(index.keys as JsonValue, 0)}, ${toShellSyntax(options, 0)})`;
}
