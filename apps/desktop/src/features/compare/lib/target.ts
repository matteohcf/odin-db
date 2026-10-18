import type { ConnectionId } from "@odin-db/bindings";

/** An open connection that a collection can be compared with. */
export interface CompareTarget {
  connectionId: ConnectionId;
  name: string;
  /** Read-only targets can be compared but never synced. */
  readOnly: boolean;
}

export interface CompareSide {
  connectionId: ConnectionId;
  database: string;
  collection: string;
}

/** Comparing a collection with itself would only report it identical. */
export function isSameCollection(left: CompareSide, right: CompareSide): boolean {
  return (
    left.connectionId === right.connectionId &&
    left.database === right.database &&
    left.collection === right.collection
  );
}

/** Up to 100: whole percent of documents read. */
export function percentOf(compared: number | null, total: number | null): number {
  if (!total || compared === null) return 0;
  return Math.min(100, Math.floor((compared / total) * 100));
}

/** A sync needs something to do and, to delete, the target's name typed back. */
export function syncReady(
  options: { insertMissing: boolean; replaceDifferent: boolean; deleteExtra: boolean },
  confirmation: string,
  collection: string,
): boolean {
  const anything = options.insertMissing || options.replaceDifferent || options.deleteExtra;
  return anything && (!options.deleteExtra || confirmation.trim() === collection);
}
