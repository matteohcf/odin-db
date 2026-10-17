import { commands } from "@odin-db/bindings";
import { useEffect, useEffectEvent } from "react";

/** Runs `steps` once after mount when `enabled`, then calls `onDone` (unattended benchmarks). */
export function useAutorun(enabled: boolean, steps: () => Promise<void>, onDone?: () => void) {
  const run = useEffectEvent(async () => {
    try {
      await steps();
    } catch (error) {
      // A failed step must not stall the unattended run; it shows up as a missing metric.
      void commands.perfAutorunLog(`step failed: ${String(error)}`);
    }
    onDone?.();
  });

  useEffect(() => {
    if (enabled) void run();
  }, [enabled]);
}

export interface AutorunProps {
  autorun?: boolean;
  onAutorunDone?: () => void;
}
