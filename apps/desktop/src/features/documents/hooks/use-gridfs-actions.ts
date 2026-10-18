import {
  type ConnectionId,
  commands,
  type FileEvent,
  type Namespace,
  type OperationId,
  type StreamEvent,
} from "@odin-db/bindings";
import type { Channel } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { JsonObject } from "@/lib/ejson-display";
import { formatBytes } from "@/lib/format";
import { call, errorMessage } from "@/lib/ipc";
import { startStream } from "@/lib/streaming";

/** Opens a file dialog, then starts the transfer; `null` when the dialog was dismissed. */
type Begin<S> = (channel: Channel<StreamEvent<FileEvent<S>>>) => Promise<OperationId | null>;

interface TransferText {
  /** "Saving report.pdf…", shown with the bytes moved so far. */
  running: string;
  done: (result: string) => string;
}

/**
 * Downloads and uploads for GridFS buckets (ADR-0038). `bucket` is set only in a
 * `<bucket>.files` collection; elsewhere the actions are not offered.
 */
export function useGridFsActions(
  connectionId: ConnectionId,
  namespace: Namespace,
  onUploaded: () => void,
) {
  const { t, i18n } = useTranslation("documents");
  const bucket = /^(.+)\.files$/.exec(namespace.collection)?.[1];

  // One toast per transfer: its progress, a Cancel button, then the outcome.
  async function transfer<S>(begin: Begin<S>, text: TransferText): Promise<S | null> {
    let started = false;
    let result: S | null = null;
    const toastId = `gridfs-${crypto.randomUUID()}`;
    try {
      const handle = await startStream<FileEvent<S>>(
        async (channel) => {
          const id = await begin(channel);
          started = id !== null;
          return id ?? "";
        },
        (event) => {
          if (event.kind === "finished") {
            result = event.value;
            return;
          }
          // f64 crosses IPC as nullable (NaN has no JSON form).
          const done = event.value.done ?? 0;
          const total = event.value.total ?? 0;
          const percent = total > 0 ? Math.floor((done / total) * 100) : 0;
          toast.loading(`${text.running} ${percent}%`, {
            id: toastId,
            description: `${formatBytes(done, i18n.language)} / ${formatBytes(total, i18n.language)}`,
            action: { label: t("gridfs.cancel"), onClick: () => void handle.cancel() },
          });
        },
      );
      if (!started) return null;
      toast.loading(text.running, {
        id: toastId,
        action: { label: t("gridfs.cancel"), onClick: () => void handle.cancel() },
      });
      const outcome = await handle.done;
      if (outcome.status === "completed" && result !== null) {
        toast.success(text.done(String(result)), { id: toastId, description: undefined });
        void commands.notifyIfUnfocused(text.done(String(result)), "");
        return result;
      }
      if (outcome.status === "cancelled") {
        toast.info(t("gridfs.cancelled"), { id: toastId, description: undefined });
      } else if (outcome.status === "failed") {
        toast.error(errorMessage(outcome.error.message), { id: toastId, description: undefined });
      }
    } catch (error) {
      toast.error(errorMessage(error), { id: toastId });
    }
    return null;
  }

  async function download(row: JsonObject) {
    const id = row._id;
    if (id === undefined) return;
    const name = typeof row.filename === "string" ? row.filename : "file";
    await transfer(
      (channel) => call(commands.downloadGridfsFile(connectionId, namespace, id, name, channel)),
      {
        running: t("gridfs.downloading", { name }),
        done: (path) => t("gridfs.downloaded", { path }),
      },
    );
  }

  async function upload() {
    const id = await transfer(
      (channel) => call(commands.uploadGridfsFile(connectionId, namespace, channel)),
      { running: t("gridfs.uploading"), done: () => t("gridfs.uploaded") },
    );
    if (id !== null) onUploaded();
  }

  return { bucket, download, upload };
}
