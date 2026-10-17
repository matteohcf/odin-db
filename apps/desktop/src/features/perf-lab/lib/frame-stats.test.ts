import { describe, expect, it } from "vitest";
import { summarizeFrames } from "./frame-stats";

describe("summarizeFrames", () => {
  it("computes fps, percentiles and long frames", () => {
    const deltas = [...Array.from({ length: 98 }, () => 16), 60, 100];
    const summary = summarizeFrames(deltas);

    expect(summary.frames).toBe(100);
    expect(summary.durationMs).toBe(98 * 16 + 160);
    expect(summary.avgFps).toBeCloseTo(100_000 / (98 * 16 + 160));
    expect(summary.p95FrameMs).toBe(16);
    expect(summary.p99FrameMs).toBe(100);
    expect(summary.longFrames).toBe(2);
  });

  it("handles an empty recording", () => {
    expect(summarizeFrames([])).toEqual({
      frames: 0,
      durationMs: 0,
      avgFps: 0,
      p95FrameMs: 0,
      p99FrameMs: 0,
      longFrames: 0,
    });
  });
});
