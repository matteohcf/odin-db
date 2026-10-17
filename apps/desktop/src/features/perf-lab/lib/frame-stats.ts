export interface FrameSummary {
  frames: number;
  durationMs: number;
  avgFps: number;
  p95FrameMs: number;
  p99FrameMs: number;
  /** Frames over 50 ms: perceived as a stall. */
  longFrames: number;
}

export function summarizeFrames(deltas: readonly number[]): FrameSummary {
  const durationMs = deltas.reduce((sum, d) => sum + d, 0);
  const sorted = [...deltas].sort((a, b) => a - b);
  const percentile = (p: number) =>
    sorted.length === 0
      ? 0
      : (sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0);

  return {
    frames: deltas.length,
    durationMs,
    avgFps: durationMs === 0 ? 0 : (deltas.length * 1000) / durationMs,
    p95FrameMs: percentile(0.95),
    p99FrameMs: percentile(0.99),
    longFrames: deltas.filter((d) => d > 50).length,
  };
}

/** Records frame intervals until `stop()` is called. */
export function recordFrames() {
  const deltas: number[] = [];
  let last = performance.now();
  let frame = requestAnimationFrame(function tick(now) {
    deltas.push(now - last);
    last = now;
    frame = requestAnimationFrame(tick);
  });

  return {
    stop(): FrameSummary {
      cancelAnimationFrame(frame);
      return summarizeFrames(deltas);
    },
  };
}

export type ScrollMode = "steady" | "jump";

const STEADY_SPEED_PX_PER_SEC = 4000;

/**
 * Scrolls `element` for `durationMs` and measures frame pacing.
 * `steady` emulates fast wheel scrolling; `jump` emulates dragging the scrollbar.
 */
export function runScrollBenchmark(
  element: HTMLElement,
  mode: ScrollMode,
  durationMs: number,
): Promise<FrameSummary> {
  return new Promise((resolve) => {
    const recorder = recordFrames();
    const start = performance.now();
    let last = start;
    element.scrollTop = 0;

    const step = (now: number) => {
      const max = element.scrollHeight - element.clientHeight;
      if (mode === "steady") {
        const next = element.scrollTop + (STEADY_SPEED_PX_PER_SEC * (now - last)) / 1000;
        element.scrollTop = next >= max ? 0 : next;
      } else {
        element.scrollTop = Math.random() * max;
      }
      last = now;
      if (now - start < durationMs) {
        requestAnimationFrame(step);
      } else {
        resolve(recorder.stop());
      }
    };
    requestAnimationFrame(step);
  });
}
