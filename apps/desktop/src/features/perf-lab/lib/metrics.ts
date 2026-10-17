import { budgets, framesWithinBudget } from "./budgets";
import type { FrameSummary } from "./frame-stats";

export function formatFrames(summary: FrameSummary) {
  return {
    value: `${summary.avgFps.toFixed(1)} fps · p95 ${summary.p95FrameMs.toFixed(1)} ms · ${summary.longFrames} stalls`,
    budget: `≥ ${budgets.minAvgFps} fps · p95 ≤ ${budgets.maxP95FrameMs} ms · ≤ ${budgets.maxLongFrames} stalls`,
    pass: framesWithinBudget(summary),
  };
}

export function formatDuration(ms: number, budgetMs: number) {
  return {
    value: `${Math.round(ms)} ms`,
    budget: `≤ ${budgetMs} ms`,
    pass: ms <= budgetMs,
  };
}

/** Resolves after the browser has painted the current state. */
export function afterPaint(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}

interface PerformanceWithMemory extends Performance {
  memory: { usedJSHeapSize: number };
}

/** Only Chromium-based webviews (WebView2) expose heap size. */
export function jsHeapMb(): number | undefined {
  const perf = performance as Partial<PerformanceWithMemory>;
  return perf.memory ? perf.memory.usedJSHeapSize / 1024 / 1024 : undefined;
}
