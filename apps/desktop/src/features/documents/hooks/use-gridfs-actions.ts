import { type ConnectionId, commands, type Namespace } from "@odin-db/bindings";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { JsonObject } from "@/lib/ejson-display";
import { call, errorMessage } from "@/lib/ipc";

/**
 * Downloads and uploads for GridFS buckets (ADR-0038). `bucket` is set only in a
 * `<bucket>.files` collection; elsewhere the actions are not offered.
 */
export function useGridFsActions(
  connectionId: ConnectionId,
  namespace: Namespace,
  onUploaded: () => void,
) {
  const { t } = useTranslation("documents");
  const bucket = /^(.+)\.files$/.exec(namespace.collection)?.[1];

  async function download(row: JsonObject) {
    if (row._id === undefined) return;
    const name = typeof row.filename === "string" ? row.filename : "file";
    const progress = toast.loading(t("gridfs.downloading", { name }));
    try {
      const path = await call(commands.downloadGridfsFile(connectionId, namespace, row._id, name));
      if (path) toast.success(t("gridfs.downloaded", { path }), { id: progress });
      else toast.dismiss(progress);
    } catch (error) {
      toast.error(errorMessage(error), { id: progress });
    }
  }

  async function upload() {
    const progress = toast.loading(t("gridfs.uploading"));
    try {
      const id = await call(commands.uploadGridfsFile(connectionId, namespace));
      if (id === null) {
        toast.dismiss(progress);
        return;
      }
      toast.success(t("gridfs.uploaded"), { id: progress });
      onUploaded();
    } catch (error) {
      toast.error(errorMessage(error), { id: progress });
    }
  }

  return { bucket, download, upload };
}
