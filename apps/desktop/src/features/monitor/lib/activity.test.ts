import type { CollectionActivity } from "@odin-db/bindings";
import { describe, expect, it } from "vitest";
import { activityRates } from "./activity";

const sample = (namespace: string, totalMicros: number, reads: number, writes: number) =>
  ({
    namespace,
    totalMicros,
    totalCount: reads + writes,
    readMicros: 0,
    readCount: reads,
    writeMicros: 0,
    writeCount: writes,
  }) satisfies CollectionActivity;

describe("activityRates", () => {
  it("ranks collections by server time per second and drops idle ones", () => {
    const rates = activityRates(
      [sample("shop.orders", 1_000, 10, 0), sample("shop.users", 5_000, 0, 0)],
      [
        sample("shop.orders", 21_000, 30, 4),
        sample("shop.users", 5_000, 0, 0),
        sample("shop.new", 2_000, 2, 0),
      ],
      2,
    );
    expect(rates).toEqual([
      { namespace: "shop.orders", busyMs: 10, readsPerSecond: 10, writesPerSecond: 2 },
      { namespace: "shop.new", busyMs: 1, readsPerSecond: 1, writesPerSecond: 0 },
    ]);
  });

  it("reads a restart as zero, not a negative rate", () => {
    expect(activityRates([sample("a.b", 9_000, 9, 9)], [sample("a.b", 10, 1, 1)], 1)).toEqual([]);
  });
});
