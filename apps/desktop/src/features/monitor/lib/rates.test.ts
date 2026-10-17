import type { ServerStatus } from "@odin-db/bindings";
import { describe, expect, it } from "vitest";
import { rates } from "./rates";

const sample = (at: number, insert: number, command: number, bytesIn: number): ServerStatus => ({
  host: "h",
  version: "8.0.0",
  process: "mongod",
  uptimeSeconds: 10,
  connectionsCurrent: 3,
  connectionsAvailable: 100,
  opcounters: { insert, query: 0, update: 0, delete: 0, getmore: 0, command },
  residentMb: 100,
  virtualMb: 200,
  networkBytesIn: bytesIn,
  networkBytesOut: 0,
  sampledAt: at,
});

describe("rates", () => {
  it("divides counter deltas by the elapsed time", () => {
    const result = rates(sample(1000, 10, 100, 0), sample(3000, 30, 140, 4096));
    expect(result?.ops.insert).toBe(10);
    expect(result?.ops.command).toBe(20);
    expect(result?.totalOps).toBe(30);
    expect(result?.bytesInPerSecond).toBe(2048);
  });

  it("reads a restart as zero and ignores samples out of order", () => {
    expect(rates(sample(1000, 500, 0, 0), sample(2000, 3, 0, 0))?.ops.insert).toBe(0);
    expect(rates(sample(2000, 0, 0, 0), sample(2000, 5, 0, 0))).toBeNull();
  });
});
