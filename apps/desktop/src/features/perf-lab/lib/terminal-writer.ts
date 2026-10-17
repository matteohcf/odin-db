import type { Terminal } from "@xterm/xterm";

// Watermarks from the xterm.js flow control guide. xterm discards input once
// ~50 MB are pending, so writes must never outrun its parser.
const HIGH_WATERMARK = 512 * 1024;

/**
 * Feeds a terminal without exceeding its parser's pending-data limit.
 * Chunks wait in `queue` while xterm is behind; `drained()` resolves once all is parsed.
 * The queue itself is unbounded: the mongosh PTY must pause its producer instead (docs/milestone-0.md).
 */
export function createTerminalWriter(terminal: Terminal) {
  const queue: string[] = [];
  let pending = 0;
  let onDrained: (() => void) | undefined;

  const pump = () => {
    while (pending < HIGH_WATERMARK) {
      const chunk = queue.shift();
      if (chunk === undefined) break;
      pending += chunk.length;
      terminal.write(chunk, () => {
        pending -= chunk.length;
        pump();
      });
    }
    if (pending === 0 && queue.length === 0) onDrained?.();
  };

  return {
    write(chunk: string) {
      queue.push(chunk);
      pump();
    },
    drained(): Promise<void> {
      return new Promise((resolve) => {
        onDrained = resolve;
        pump();
      });
    },
  };
}
