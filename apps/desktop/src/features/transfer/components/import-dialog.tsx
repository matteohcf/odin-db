import {
  type ConnectionId,
  type CsvColumn,
  type CsvType,
  commands,
  type DroppedFile,
  type FilePreview,
  type ImportSummary,
  type Namespace,
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
import { Input } from "@odin-db/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@odin-db/ui/components/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@odin-db/ui/components/table";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckboxField } from "@/components/checkbox-field";
import { FilePicker } from "@/components/file-picker";
import { describeEJson } from "@/lib/ejson-display";
import { call } from "@/lib/ipc";
import { useTransfer } from "../hooks/use-transfer";
import { DEFAULT_IMPORT_MODE, ImportModeFields, importModeReady } from "./import-mode-fields";
import { TransferStatus } from "./transfer-status";

interface ImportDialogProps {
  connectionId: ConnectionId;
  namespace: Namespace;
  /** Called after an import that inserted documents, e.g. to refresh results. */
  onImported: () => void;
  onClose: () => void;
}

interface ChosenFile {
  token: string;
  name: string;
  preview: FilePreview;
}

const CSV_TYPES: CsvType[] = [
  "string",
  "int32",
  "int64",
  "double",
  "decimal",
  "boolean",
  "date",
  "objectId",
  "json",
  "skip",
];

export function ImportDialog({ connectionId, namespace, onImported, onClose }: ImportDialogProps) {
  const { t } = useTranslation("transfer");
  const [file, setFile] = useState<ChosenFile | null>(null);
  const [columns, setColumns] = useState<CsvColumn[]>([]);
  const [stopOnError, setStopOnError] = useState(false);
  const [ignoreEmptyStrings, setIgnoreEmptyStrings] = useState(false);
  const [mode, setMode] = useState(DEFAULT_IMPORT_MODE);
  const transfer = useTransfer<ImportSummary>(t("import.title"));
  const { state } = transfer;
  const busy = state.status === "running";
  const done =
    state.status === "finished" || state.status === "cancelled" || state.status === "failed";

  function apply(chosen: ChosenFile) {
    setFile(chosen);
    setColumns(
      chosen.preview.kind === "csv"
        ? chosen.preview.headers.map((header, index) => ({
            header,
            field: header,
            kind:
              chosen.preview.kind === "csv"
                ? (chosen.preview.suggested[index] ?? "string")
                : "string",
          }))
        : [],
    );
  }

  const picker = {
    kind: "file" as const,
    title: t("import.dropTitle"),
    hint: t("import.dropHint"),
    browseLabel: t("import.choose"),
    onBrowse: async () => {
      const chosen = await call(commands.chooseImportFile());
      if (chosen) apply(chosen);
    },
    onDrop: async (dropped: DroppedFile) =>
      apply(await call(commands.importFileFromDrop(dropped.token))),
  };

  async function submit() {
    if (!file) return;
    const format =
      file.preview.kind === "csv"
        ? { kind: "csv" as const, columns, ignoreEmptyStrings }
        : { kind: "json" as const };
    await transfer.start((channel) =>
      call(
        commands.importDocuments(
          connectionId,
          namespace,
          file.token,
          { format, stopOnError, mode: mode.mode, dropFirst: mode.dropFirst },
          channel,
        ),
      ),
    );
    onImported();
  }

  const updateColumn = (index: number, patch: Partial<CsvColumn>) =>
    setColumns((current) =>
      current.map((column, i) => (i === index ? { ...column, ...patch } : column)),
    );

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[calc(100vh-3rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("import.title")}</DialogTitle>
          <DialogDescription>
            {t("import.description", {
              namespace: `${namespace.database}.${namespace.collection}`,
            })}
          </DialogDescription>
        </DialogHeader>

        {state.status !== "idle" ? (
          <TransferStatus
            state={state}
            runningTitle={t("import.running")}
            running={(progress) => t("import.progress", { documents: progress?.documents ?? 0 })}
            finished={(summary) => <ImportResult summary={summary} />}
            cancelledText={t("import.cancelled")}
            failedText={(message) => t("import.failed", { message })}
          />
        ) : !file ? (
          <FilePicker {...picker} />
        ) : (
          <div className="flex flex-col gap-4">
            <FilePicker
              {...picker}
              selected={{
                name: file.name,
                detail:
                  file.preview.kind === "csv"
                    ? t("import.csvDetail", { count: file.preview.headers.length })
                    : t("import.jsonDetail", { count: file.preview.documents.length }),
              }}
              onClear={() => setFile(null)}
            />
            {file.preview.kind === "json" ? (
              <div className="flex flex-col gap-2">
                <p className="font-medium text-sm">
                  {file.preview.documents.length === 0
                    ? t("import.jsonEmpty", { name: file.name })
                    : t("import.jsonPreview", {
                        count: file.preview.documents.length,
                        name: file.name,
                      })}
                </p>
                <ol className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-md border p-2">
                  {file.preview.documents.map((document, position) => {
                    const text = describeEJson(document).text;
                    return (
                      // Positional preview rows, replaced as a whole.
                      <li
                        key={position}
                        title={text}
                        className="truncate rounded-sm bg-muted/60 px-2 py-1 font-mono text-[11px]"
                      >
                        {text}
                      </li>
                    );
                  })}
                </ol>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <p className="font-medium text-sm">{t("import.csvColumns", { name: file.name })}</p>
                <div className="max-h-72 overflow-y-auto rounded-md border">
                  <Table>
                    <TableHeader className="sticky top-0 bg-sidebar">
                      <TableRow className="hover:bg-transparent">
                        <TableHead>{t("import.column")}</TableHead>
                        <TableHead>{t("import.sample")}</TableHead>
                        <TableHead>{t("import.field")}</TableHead>
                        <TableHead>{t("import.type")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {columns.map((column, index) => (
                        <TableRow key={column.header} className="hover:bg-transparent">
                          <TableCell className="py-1.5 font-medium">{column.header}</TableCell>
                          <TableCell className="max-w-40 truncate py-1.5 font-mono text-muted-foreground">
                            {file.preview.kind === "csv"
                              ? (file.preview.rows[0]?.[index] ?? "")
                              : ""}
                          </TableCell>
                          <TableCell className="py-1.5">
                            <Input
                              value={column.field}
                              disabled={column.kind === "skip"}
                              onChange={(event) =>
                                updateColumn(index, { field: event.target.value })
                              }
                              aria-label={t("import.field")}
                              className="h-7 font-mono text-xs"
                            />
                          </TableCell>
                          <TableCell className="w-40 py-1.5">
                            <Select
                              value={column.kind}
                              onValueChange={(kind) =>
                                updateColumn(index, { kind: kind as CsvType })
                              }
                            >
                              <SelectTrigger
                                size="sm"
                                className="h-7 w-full text-xs"
                                aria-label={t("import.type")}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {CSV_TYPES.map((kind) => (
                                  <SelectItem key={kind} value={kind} className="text-xs">
                                    {t(`csvTypes.${kind}`)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            <ImportModeFields
              value={mode}
              onChange={setMode}
              scope="collection"
              target={namespace.collection}
            />

            <CheckboxField
              checked={stopOnError}
              onCheckedChange={setStopOnError}
              label={t("import.stopOnError")}
              hint={t("import.stopOnErrorHint")}
            />
            {file?.preview.kind === "csv" && (
              <CheckboxField
                checked={ignoreEmptyStrings}
                onCheckedChange={setIgnoreEmptyStrings}
                label={t("import.ignoreEmpty")}
                hint={t("import.ignoreEmptyHint")}
              />
            )}
          </div>
        )}

        <DialogFooter
          className={file && state.status === "idle" ? "sm:justify-between" : undefined}
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
              {file && (
                <Button
                  onClick={() => void submit()}
                  disabled={
                    (file.preview.kind === "json" && file.preview.documents.length === 0) ||
                    !importModeReady(mode, namespace.collection)
                  }
                >
                  {t("import.submit")}
                </Button>
              )}
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImportResult({ summary }: { summary: ImportSummary }) {
  const { t } = useTranslation("transfer");
  const failed = summary.failed ?? 0;
  const inserted = summary.inserted ?? 0;
  const updated = summary.updated ?? 0;
  return (
    <>
      <p className={failed === 0 ? "text-success" : undefined}>
        {t("import.done", { count: inserted })}
        {updated > 0 && ` ${t("import.updated", { count: updated })}`}
      </p>
      {failed > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-destructive">
            {t("import.failedCount", { count: failed })}
            {summary.stopped && ` ${t("import.stopped")}`}
          </p>
          <ul className="max-h-40 overflow-y-auto rounded-md border p-2 font-mono text-xs selectable">
            {summary.errors.map((error) => (
              <li key={`${error.record}-${error.message}`} className="flex gap-2">
                <span className="shrink-0 text-muted-foreground">
                  {t("import.record", { record: error.record })}
                </span>
                <span className="break-words">{error.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
