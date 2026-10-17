import {
  type ConnectionId,
  commands,
  type DatabaseProgress,
  type DatabaseTransferSummary,
} from "@odin-db/bindings";
import { Button } from "@odin-db/ui/components/button";
import { Checkbox } from "@odin-db/ui/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@odin-db/ui/components/dialog";
import { Input } from "@odin-db/ui/components/input";
import { Label } from "@odin-db/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@odin-db/ui/components/select";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CircleAlert } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { call } from "@/lib/ipc";
import { useTransfer } from "../hooks/use-transfer";
import { DatabaseTransferResult } from "./database-transfer-result";
import { DEFAULT_IMPORT_MODE, ImportModeFields, importModeReady } from "./import-mode-fields";
import { TransferStatus } from "./transfer-status";

export interface CopyTarget {
  connectionId: ConnectionId;
  name: string;
  readOnly: boolean;
}

interface CopyDialogProps {
  sourceConnectionId: ConnectionId;
  database: string;
  /** Copies one collection; without it, the whole database. */
  collection?: string | undefined;
  /** Open connections the data can go to, the source included. */
  targets: readonly CopyTarget[];
  /** Called after the copy ran, e.g. to refresh the target's tree. */
  onCopied: (target: ConnectionId) => void;
  onClose: () => void;
}

/** Copies a collection or a database to another connection, or within the same one. */
export function CopyDialog({
  sourceConnectionId,
  database,
  collection,
  targets,
  onCopied,
  onClose,
}: CopyDialogProps) {
  const { t } = useTranslation("transfer");
  const id = useId();
  const writable = targets.filter((target) => !target.readOnly);
  const initial =
    writable.find((target) => target.connectionId === sourceConnectionId) ?? writable[0];
  const [targetId, setTargetId] = useState<ConnectionId | undefined>(initial?.connectionId);
  const sameConnection = targetId === sourceConnectionId;
  // Within the same connection the default names must differ from the source.
  const defaultNames = (same: boolean) => ({
    database: collection || !same ? database : `${database}_copy`,
    collection: collection && same ? `${collection}_copy` : (collection ?? ""),
  });
  const [targetDatabase, setTargetDatabase] = useState(() => defaultNames(sameConnection).database);
  const [targetCollection, setTargetCollection] = useState(
    () => defaultNames(sameConnection).collection,
  );
  const [copyIndexes, setCopyIndexes] = useState(true);
  const [mode, setMode] = useState(DEFAULT_IMPORT_MODE);
  const transfer = useTransfer<DatabaseTransferSummary, DatabaseProgress>();
  const { state } = transfer;
  const busy = state.status === "running";
  const done =
    state.status === "finished" || state.status === "cancelled" || state.status === "failed";

  const databases = useQuery({
    queryKey: ["copy-target-databases", targetId],
    queryFn: () => call(commands.listDatabases(targetId as ConnectionId)),
    enabled: targetId !== undefined,
  });

  const trimmedDatabase = targetDatabase.trim();
  const trimmedCollection = targetCollection.trim();
  const ontoItself =
    sameConnection &&
    trimmedDatabase === database &&
    (!collection || (trimmedCollection || collection) === collection);
  const confirmTarget = collection ? trimmedCollection || collection : trimmedDatabase;
  const ready =
    targetId !== undefined &&
    trimmedDatabase !== "" &&
    (!collection || trimmedCollection !== "") &&
    !ontoItself &&
    importModeReady(mode, confirmTarget);

  async function submit() {
    if (!targetId) return;
    await transfer.start((channel) =>
      call(
        commands.copyData(
          sourceConnectionId,
          targetId,
          {
            sourceDatabase: database,
            sourceCollection: collection ?? null,
            targetDatabase: trimmedDatabase,
            targetCollection: collection ? trimmedCollection : null,
            mode: mode.mode,
            dropTarget: mode.dropFirst,
            copyIndexes,
          },
          channel,
        ),
      ),
    );
    onCopied(targetId);
  }

  const source = collection ? `${database}.${collection}` : database;

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[calc(100vh-3rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {collection ? t("copy.collectionTitle") : t("copy.databaseTitle")}
          </DialogTitle>
          <DialogDescription>
            {collection
              ? t("copy.collectionDescription", { source })
              : t("copy.databaseDescription", { source })}
          </DialogDescription>
        </DialogHeader>

        {state.status !== "idle" ? (
          <TransferStatus
            state={state}
            runningTitle={t("copy.running")}
            running={(progress) =>
              progress
                ? t("copy.progress", {
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
                done={t("copy.done", {
                  count: summary.collections ?? 0,
                  documents: summary.documents ?? 0,
                  updated: summary.updated ?? 0,
                })}
              />
            )}
            cancelledText={t("copy.cancelled")}
            failedText={(message) => t("copy.failed", { message })}
          />
        ) : writable.length === 0 ? (
          <p className="flex items-start gap-2 text-muted-foreground text-sm">
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            {t("copy.noTargets")}
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-target`}>{t("copy.target")}</Label>
              <Select
                value={targetId ?? ""}
                onValueChange={(value) => {
                  const names = defaultNames(value === sourceConnectionId);
                  setTargetId(value as ConnectionId);
                  setTargetDatabase(names.database);
                  setTargetCollection(names.collection);
                }}
              >
                <SelectTrigger id={`${id}-target`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {targets.map((target) => (
                    <SelectItem
                      key={target.connectionId}
                      value={target.connectionId}
                      disabled={target.readOnly}
                    >
                      {target.name}
                      {target.connectionId === sourceConnectionId && ` ${t("copy.thisConnection")}`}
                      {target.readOnly && ` ${t("copy.readOnly")}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">{t("copy.targetHint")}</p>
            </div>

            <div className={collection ? "grid grid-cols-2 gap-3" : "flex flex-col"}>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${id}-database`}>{t("copy.database")}</Label>
                <Input
                  id={`${id}-database`}
                  list={`${id}-databases`}
                  value={targetDatabase}
                  onChange={(event) => setTargetDatabase(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono text-xs"
                />
                <datalist id={`${id}-databases`}>
                  {databases.data?.map((info) => (
                    <option key={info.name} value={info.name} />
                  ))}
                </datalist>
              </div>
              {collection && (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`${id}-collection`}>{t("copy.collection")}</Label>
                  <Input
                    id={`${id}-collection`}
                    value={targetCollection}
                    onChange={(event) => setTargetCollection(event.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    className="font-mono text-xs"
                  />
                </div>
              )}
            </div>
            <p className="-mt-2 flex items-center gap-1.5 font-mono text-muted-foreground text-xs">
              {source}
              <ArrowRight className="size-3" />
              {collection ? `${trimmedDatabase}.${trimmedCollection}` : trimmedDatabase}
            </p>
            {ontoItself && (
              <p role="alert" className="flex items-start gap-1.5 text-destructive text-xs">
                <CircleAlert className="mt-px size-3.5 shrink-0" />
                {t("copy.ontoItself")}
              </p>
            )}

            <div className="flex items-start gap-2.5">
              <Checkbox
                id={`${id}-indexes`}
                checked={copyIndexes}
                onCheckedChange={(checked) => setCopyIndexes(checked === true)}
                className="mt-0.5"
              />
              <div className="flex flex-col gap-0.5">
                <Label htmlFor={`${id}-indexes`} className="font-normal">
                  {t("copy.indexes")}
                </Label>
                <span className="text-muted-foreground text-xs">{t("copy.indexesHint")}</span>
              </div>
            </div>

            <ImportModeFields
              value={mode}
              onChange={setMode}
              scope={collection ? "copyCollection" : "copyDatabase"}
              target={confirmTarget}
            />
          </div>
        )}

        <DialogFooter>
          {busy ? (
            <Button variant="outline" onClick={transfer.cancel}>
              {t("actions.stop")}
            </Button>
          ) : done ? (
            <Button onClick={onClose}>{t("actions.close")}</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={onClose}>
                {t("actions.cancel")}
              </Button>
              {writable.length > 0 && (
                <Button onClick={() => void submit()} disabled={!ready}>
                  {t("copy.submit")}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
