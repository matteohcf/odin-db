import { commands, type ModelDownloadProgress } from "@odin-db/bindings";
import { create } from "zustand";
import { call, errorMessage } from "@/lib/ipc";
import { type StreamHandle, startStream } from "@/lib/streaming";

interface Download {
  progress: ModelDownloadProgress | null;
  handle: StreamHandle | null;
  /** Pause was pressed before the backend returned the operation id. */
  pausing: boolean;
}

type Outcome = { status: "installed" } | { status: "paused" } | { status: "failed"; error: string };

interface DownloadsState {
  /** Model downloads in progress, by model id; they go on while settings is closed. */
  downloads: Record<string, Download>;
  start: (model: string) => Promise<Outcome>;
  /** Stops the download, keeping what arrived so it can resume. */
  pause: (model: string) => void;
}

export const useModelDownloads = create<DownloadsState>()((set, get) => {
  const patch = (model: string, change: Partial<Download> | null) =>
    set(({ downloads }) => {
      const next = { ...downloads };
      const current = next[model];
      if (change === null) delete next[model];
      else if (current) next[model] = { ...current, ...change };
      return { downloads: next };
    });

  return {
    downloads: {},
    start: async (model) => {
      set(({ downloads }) => ({
        downloads: { ...downloads, [model]: { progress: null, handle: null, pausing: false } },
      }));
      try {
        const handle = await startStream<ModelDownloadProgress>(
          (channel) => call(commands.downloadAiModel(model, channel)),
          (progress) => patch(model, { progress }),
        );
        patch(model, { handle });
        if (get().downloads[model]?.pausing) void handle.cancel();
        const outcome = await handle.done;
        if (outcome.status === "completed") return { status: "installed" };
        if (outcome.status === "cancelled") return { status: "paused" };
        return { status: "failed", error: errorMessage(outcome.error.message) };
      } catch (error) {
        return { status: "failed", error: errorMessage(error) };
      } finally {
        patch(model, null);
      }
    },
    pause: (model) => {
      const download = get().downloads[model];
      if (!download) return;
      patch(model, { pausing: true });
      void download.handle?.cancel();
    },
  };
});
