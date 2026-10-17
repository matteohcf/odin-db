import type { Opcounters, ServerStatus } from "@odin-db/bindings";

export interface Rates {
  /** Operations per second, by kind. */
  ops: Record<keyof Opcounters, number>;
  totalOps: number;
  bytesInPerSecond: number;
  bytesOutPerSecond: number;
}

const KINDS = ["insert", "query", "update", "delete", "getmore", "command"] as const;

/**
 * Per-second rates between two samples. Counters reset when the server
 * restarts, so a drop reads as zero rather than a negative rate.
 */
export function rates(previous: ServerStatus, next: ServerStatus): Rates | null {
  const seconds = ((next.sampledAt ?? 0) - (previous.sampledAt ?? 0)) / 1000;
  if (seconds <= 0) return null;
  const per = (from: number | null, to: number | null) =>
    Math.max(0, ((to ?? 0) - (from ?? 0)) / seconds);
  const ops = Object.fromEntries(
    KINDS.map((kind) => [kind, per(previous.opcounters[kind], next.opcounters[kind])]),
  ) as Rates["ops"];
  return {
    ops,
    totalOps: KINDS.reduce((sum, kind) => sum + ops[kind], 0),
    bytesInPerSecond: per(previous.networkBytesIn, next.networkBytesIn),
    bytesOutPerSecond: per(previous.networkBytesOut, next.networkBytesOut),
  };
}
