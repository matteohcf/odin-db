import type { CollectionActivity } from "@odin-db/bindings";

export interface ActivityRate {
  namespace: string;
  /** Milliseconds of server time per second of wall time: how busy the collection keeps it. */
  busyMs: number;
  readsPerSecond: number;
  writesPerSecond: number;
}

/**
 * The collections that took server time between two `top` samples, busiest first. Counters
 * reset when the server restarts, so a drop reads as zero.
 */
export function activityRates(
  previous: readonly CollectionActivity[],
  next: readonly CollectionActivity[],
  seconds: number,
  limit = 10,
): ActivityRate[] {
  if (seconds <= 0) return [];
  const before = new Map(previous.map((entry) => [entry.namespace, entry]));
  const per = (from: number | null | undefined, to: number | null) =>
    Math.max(0, ((to ?? 0) - (from ?? 0)) / seconds);
  return next
    .map((entry) => {
      const old = before.get(entry.namespace);
      return {
        namespace: entry.namespace,
        busyMs: per(old?.totalMicros, entry.totalMicros) / 1000,
        readsPerSecond: per(old?.readCount, entry.readCount),
        writesPerSecond: per(old?.writeCount, entry.writeCount),
      };
    })
    .filter((rate) => rate.busyMs > 0)
    .sort((a, b) => b.busyMs - a.busyMs)
    .slice(0, limit);
}
