import { commands, type UpdateProgress } from "@odin-db/bindings";
import { call } from "@/lib/ipc";
import { type StreamHandle, startStream } from "@/lib/streaming";

/**
 * Downloads, verifies and installs the update; on success the backend restarts the
 * app, so `done` only settles for a cancelled or failed install.
 */
export function installUpdate(
  onProgress: (progress: UpdateProgress) => void,
): Promise<StreamHandle> {
  return startStream<UpdateProgress>(
    (channel) => call(commands.installUpdate(channel)),
    onProgress,
  );
}

/** 0–100, or `null` while the size is unknown. */
export function percentOf({ done, total }: UpdateProgress): number | null {
  if (!total || done === null) return null;
  return Math.min(100, Math.floor((done / total) * 100));
}
