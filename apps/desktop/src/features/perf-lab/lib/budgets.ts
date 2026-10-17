import type { FrameSummary } from "./frame-stats";

/** Milestone 0 go/no-go thresholds (docs/milestone-0.md). */
export const budgets = {
  gridLoadMs: 3000,
  editorLoadMs: 1500,
  terminalMbPerSec: 20,
  minAvgFps: 55,
  maxP95FrameMs: 25,
  maxLongFrames: 2,
} as const;

export function framesWithinBudget(summary: FrameSummary): boolean {
  return (
    summary.avgFps >= budgets.minAvgFps &&
    summary.p95FrameMs <= budgets.maxP95FrameMs &&
    summary.longFrames <= budgets.maxLongFrames
  );
}
