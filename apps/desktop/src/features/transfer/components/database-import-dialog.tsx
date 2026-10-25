import {
  type ConnectionId,
  commands,
  type DatabaseProgress,
  type DatabaseTransferSummary,
  type DroppedFile,
} from "@odin-db/bindings";
import { Button } from "@odin-db/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@odin-db/ui/components/dialog";
import { Table2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckboxField } from "@/components/checkbox-field";
import { FilePicker } from "@/components/file-picker";
import { call } from "@/lib/ipc";
import { useTransfer } from "../hooks/use-transfer";
import { DatabaseTransferResult } from "./database-transfer-result";
import { DEFAULT_IMPORT_MODE, ImportModeFields, importModeReady } from "./import-mode-fields";
import { TransferStatus } from "./transfer-status";

interface DatabaseImportDialogProps {
  connectionId: ConnectionId;
  database: string;
  /** Called after the import ran, e.g. to refresh the tree. */
  onImported: () => void;
  onClose: () => void;
}

interface ChosenFolder {
  token: string;
  path: string;
  collections: string[];
}

/** Imports a folder of JSON files, one collection per file. */
export function DatabaseImportDialog({
  connectionId,
  database,
  onImported,
  onClose,
}: DatabaseImportDialogProps) {
  const { t } = useTranslation("transfer");
  const [folder, setFolder] = useState<ChosenFolder | null>(null);
  const [mode, setMode] = useState(DEFAULT_IMPORT_MODE);
  const [stopOnError, setStopOnError] = useState(false);
  const transfer = useTransfer<DatabaseTransferSummary, DatabaseProgress>(
    t("database.import.title"),
  );
  const { state } = transfer;
  const busy = state.status === "running";
  const done =
    state.status === "finished" || state.status === "cancelled" || state.status === "failed";

  const picker = {
    kind: "folder" as const,
    title: t("database.import.dropTitle"),
    hint: t("database.import.dropHint"),
    browseLabel: t("database.import.choose"),
    onBrowse: async () => {
      const chosen = await call(commands.chooseImportFolder());
      if (chosen) setFolder(chosen);
    },
    onDrop: async (dropped: DroppedFile) =>
      setFolder(await call(commands.importFolderFromDrop(dropped.token))),
  };

  async function submit() {
    if (!folder) return;
    await transfer.start((channel) =>
      call(
        commands.importDatabase(
          connectionId,
          database,
          folder.token,
          { format: { kind: "json" }, stopOnError, mode: mode.mode, dropFirst: mode.dropFirst },
          channel,
        ),
      ),
    );
    onImported();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[calc(100vh-3rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("database.import.title")}</DialogTitle>
          <DialogDescription>{t("database.import.description", { database })}</DialogDescription>
        </DialogHeader>

        {state.status !== "idle" ? (
          <TransferStatus
            state={state}
            runningTitle={t("database.import.running")}
            running={(progress) =>
              progress
                ? t("database.import.progress", {
                    collection: progress.collection,
                    index: progress.index ?? 0,
                    total: progress.total ?? 0,
                    documents: progress.documents ?? 0,
                  })
                : ""
            }
            finished={(summary) => (
              <DatabaseTransferResult
                summary={summary}
                done={t("database.import.done", {
                  collections: summary.collections ?? 0,
                  documents: summary.documents ?? 0,
                  updated: summary.updated ?? 0,
                })}
              />
            )}
            cancelledText={t("database.import.cancelled")}
            failedText={(message) => t("database.import.failed", { message })}
          />
        ) : !folder ? (
          <FilePicker {...picker} />
        ) : (
          <div className="flex flex-col gap-4">
            <FilePicker
              {...picker}
              selected={{
                name: folder.path.split(/[\\/]/).at(-1) || folder.path,
                detail: t("database.import.folderDetail", { count: folder.collections.length }),
              }}
              onClear={() => setFolder(null)}
            />
            {folder.collections.length === 0 ? (
              <p className="text-muted-foreground text-sm selectable">
                {t("database.import.empty", { path: folder.path })}
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                <p className="truncate font-medium text-sm" title={folder.path}>
                  {t("database.import.files", {
                    count: folder.collections.length,
                    path: folder.path,
                  })}
                </p>
                <ul className="grid max-h-40 grid-cols-2 gap-x-4 gap-y-1 overflow-y-auto rounded-md border p-2.5">
                  {folder.collections.map((name) => (
                    <li key={name} className="flex items-center gap-2 font-mono text-xs">
                      <Table2 className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">{name}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <ImportModeFields value={mode} onChange={setMode} scope="database" target={database} />

            <CheckboxField
              checked={stopOnError}
              onCheckedChange={setStopOnError}
              label={t("import.stopOnError")}
              hint={t("import.stopOnErrorHint")}
            />
          </div>
        )}

        <DialogFooter
          className={folder && state.status === "idle" ? "sm:justify-between" : undefined}
        >
          {busy ? (
            <Button variant="outline" onClick={transfer.cancel}>
              {t("actions.stop")}
            </Button>
          ) : done ? (
            <Button onClick={onClose}>{t("actions.close")}</Button>
          ) : (
            <div className="flex gap-2">
              <Button variant="ghost" onClick={onClose}>
                {t("actions.cancel")}
              </Button>
              {folder && (
                <Button
                  onClick={() => void submit()}
                  disabled={folder.collections.length === 0 || !importModeReady(mode, database)}
                >
                  {t("database.import.submit")}
                </Button>
              )}
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
