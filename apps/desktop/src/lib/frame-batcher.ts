/**
 * Buffers streamed items and delivers them at most once per animation frame,
 * so a fast backend stream cannot trigger a render per message (ADR-0010).
 */
export function createFrameBatcher<T>(flush: (items: T[]) => void) {
  let pending: T[] = [];
  let frame = 0;

  const run = () => {
    frame = 0;
    const items = pending;
    pending = [];
    flush(items);
  };

  return {
    push(items: readonly T[]) {
      for (const item of items) pending.push(item);
      if (frame === 0) frame = requestAnimationFrame(run);
    },
    flushNow() {
      if (frame !== 0) cancelAnimationFrame(frame);
      if (pending.length > 0) run();
      frame = 0;
    },
    cancel() {
      if (frame !== 0) cancelAnimationFrame(frame);
      frame = 0;
      pending = [];
    },
  };
}
