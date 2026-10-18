import type { ProfileEntry } from "@odin-db/bindings";

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
