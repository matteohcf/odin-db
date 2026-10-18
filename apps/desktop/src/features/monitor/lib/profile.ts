import type { ProfileEntry } from "@odin-db/bindings";
import { isJsonObject } from "@/lib/ejson-display";
import { toShellSyntax } from "@/lib/shell-syntax";

/** More documents read per document returned than this suggests a missing index. */
const WASTEFUL_RATIO = 100;

/** Why an operation probably needs an index, or `null` when it looks fine. */
export function indexHint(entry: ProfileEntry): "collscan" | "wasteful" | null {
  if (entry.planSummary?.startsWith("COLLSCAN") && (entry.docsExamined ?? 0) > 0) {
    return "collscan";
  }
  const examined = entry.docsExamined ?? 0;
  const returned = Math.max(1, entry.returned ?? 0);
  return examined / returned > WASTEFUL_RATIO ? "wasteful" : null;
}

export interface ProfiledQuery {
  database: string;
  collection: string;
  /** Query bar text, in mongosh syntax. */
  filter: string;
  sort: string;
}

/** The filter and sort of a recorded read or write, to rerun it in its collection. */
export function profiledQuery(entry: ProfileEntry): ProfiledQuery | null {
  const dot = entry.ns.indexOf(".");
  const command = entry.command;
  if (dot <= 0 || !isJsonObject(command)) return null;
  // find and count carry `filter`/`query`; update and delete statements carry `q`.
  const filter = command.filter ?? command.query ?? command.q;
  if (!isJsonObject(filter)) return null;
  const sort = isJsonObject(command.sort) ? command.sort : null;
  return {
    database: entry.ns.slice(0, dot),
    collection: entry.ns.slice(dot + 1),
    filter: Object.keys(filter).length ? toShellSyntax(filter, 0) : "",
    sort: sort && Object.keys(sort).length ? toShellSyntax(sort, 0) : "",
  };
}
