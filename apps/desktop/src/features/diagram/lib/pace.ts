import type { ScanPace } from "@odin-db/bindings";

const GB = 1024 ** 3;

/** The pace a new scan suggests for a database of this size (ADR-0060). */
export function recommendPace({
  collections,
  bytes,
}: {
  collections: number;
  bytes: number;
}): ScanPace {
  if (collections >= 300 || bytes >= 50 * GB) return "gentle";
  if (collections <= 50 && bytes < GB) return "fast";
  return "balanced";
}
