import {
  type ConnectionId,
  commands,
  type ExportFormat,
  type ExportSource,
  type JsonMode,
  type Namespace,
  type TransferSummary,
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
import { Label } from "@odin-db/ui/components/label";
import { RadioGroup, RadioGroupItem } from "@odin-db/ui/components/radio-group";
import { cn } from "@odin-db/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatBytes } from "@/lib/format";
import { call } from "@/lib/ipc";
import { useTransfer } from "../hooks/use-transfer";
import { TransferStatus } from "./transfer-status";

interface ExportDialogProps {
  connectionId: ConnectionId;
  namespace: Namespace;
  source: ExportSource;
  /** Known columns, pre-selected for CSV. */
  columns: readonly string[];
  /** The whole collection rather than a query's results: says so in the title. */
  whole?: boolean;
  onClose: () => void;
}

const FORMATS: ExportFormat[] = ["jsonArray", "ndjson", "csv"];

export function ExportDialog({
  connectionId,
  namespace,
  source,
  columns,
  whole = false,
  onClose,
}: ExportDialogProps) {
  const { t } = useTranslation("transfer");
  const id = useId();
  const [format, setFormat] = useState<ExportFormat>("jsonArray");
  const [jsonMode, setJsonMode] = useState<JsonMode>("canonical");
  const [escapeFormulas, setEscapeFormulas] = useState(false);
  const [fields, setFields] = useState<ReadonlySet<string>>(() => new Set(columns));
  const transfer = useTransfer<TransferSummary>(t("export.title"));
  // What a find export will write, so an empty or huge export is no surprise.
  const counted = useQuery({
    queryKey: ["export-count", connectionId, namespace, source],
    queryFn: () =>
      source.kind === "find"
        ? call(
            commands.countDocuments(
              connectionId,
              namespace,
              source.request.filter,
              source.request.options ?? null,
            ),
          )
        : null,
    enabled: source.kind === "find",
  });
  const exportCount =
    source.kind === "find" && typeof counted.data === "number"
      ? Math.max(
          0,
          Math.min(
            counted.data - Number(source.request.skip ?? 0),
            source.request.limit ? Number(source.request.limit) : Number.POSITIVE_INFINITY,
          ),
        )
      : undefined;
  const { state } = transfer;
  const busy = state.status === "running";
  const done =
    state.status === "finished" || state.status === "cancelled" || state.status === "failed";

  const submit = () =>
    transfer.start((channel) =>
      call(
        commands.exportDocuments(
          connectionId,
          namespace,
          {
            source,
            format,
            jsonMode,
            // Keep the grid's column order; empty lets the backend discover columns.
            csvFields: format === "csv" ? columns.filter((column) => fields.has(column)) : [],
            escapeFormulas: format === "csv" && escapeFormulas,
          },
          channel,
        ),
      ),
    );

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {whole
              ? t("export.titleCollection", { collection: namespace.collection })
              : t("export.title")}
          </DialogTitle>
          <DialogDescription>
            {whole
              ? t("export.descriptionCollection", {
                  namespace: `${namespace.database}.${namespace.collection}`,
                })
              : t("export.description")}
          </DialogDescription>
          {exportCount !== undefined && (
            <p
              className={cn(
                "text-xs",
                exportCount === 0 ? "text-warning" : "text-muted-foreground",
              )}
            >
              {exportCount === 0 ? t("export.nothing") : t("export.count", { count: exportCount })}
            </p>
          )}
        </DialogHeader>

        {state.status === "idle" ? (
          <div className="flex flex-col gap-5">
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 font-medium text-sm">{t("export.format")}</legend>
              <div className="grid grid-cols-3 gap-2">
                {FORMATS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={format === value}
                    onClick={() => setFormat(value)}
                    className={cn(
                      "flex flex-col items-start gap-1 rounded-md border p-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                      format === value ? "border-primary bg-selection" : "hover:bg-accent",
                    )}
                  >
                    <span className="font-medium text-sm">{t(`export.${value}`)}</span>
                    <span className="text-muted-foreground text-xs">
                      {t(`export.${value}Hint`)}
                    </span>
                  </button>
                ))}
              </div>
            </fieldset>

            {format === "csv" ? (
              <fieldset className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <legend className="font-medium text-sm">{t("export.fields")}</legend>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs"
                    onClick={() => setFields(new Set(columns))}
                  >
                    {t("export.allFields")}
                  </Button>
                </div>
                <div className="grid max-h-48 grid-cols-2 gap-x-4 gap-y-1.5 overflow-y-auto rounded-md border p-2.5">
                  {columns.map((column) => (
                    <div key={column} className="flex items-center gap-2">
                      <Checkbox
                        id={`${id}-${column}`}
                        checked={fields.has(column)}
                        onCheckedChange={(checked) =>
                          setFields((current) => {
                            const next = new Set(current);
                            if (checked === true) next.add(column);
                            else next.delete(column);
                            return next;
                          })
                        }
                      />
                      <Label
                        htmlFor={`${id}-${column}`}
                        className="truncate font-mono font-normal text-xs"
                      >
                        {column}
                      </Label>
                    </div>
                  ))}
                </div>
                <p className="text-muted-foreground text-xs">{t("export.fieldsHint")}</p>
                <div className="flex items-start gap-2 pt-1">
                  <Checkbox
                    id={`${id}-escape`}
                    checked={escapeFormulas}
                    onCheckedChange={(checked) => setEscapeFormulas(checked === true)}
                    className="mt-0.5"
                  />
                  <div className="flex flex-col gap-0.5">
                    <Label htmlFor={`${id}-escape`} className="font-normal text-sm">
                      {t("export.escapeFormulas")}
                    </Label>
                    <p className="text-muted-foreground text-xs">
                      {t("export.escapeFormulasHint")}
                    </p>
                  </div>
                </div>
              </fieldset>
            ) : (
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-2 font-medium text-sm">{t("export.types")}</legend>
                <RadioGroup
                  value={jsonMode}
                  onValueChange={(value) => setJsonMode(value as JsonMode)}
                >
                  {(["canonical", "relaxed"] as const).map((mode) => (
                    <div key={mode} className="flex items-start gap-2.5">
                      <RadioGroupItem id={`${id}-${mode}`} value={mode} className="mt-0.5" />
                      <div className="flex flex-col gap-0.5">
                        <Label htmlFor={`${id}-${mode}`} className="font-normal">
                          {t(`export.${mode}`)}
                        </Label>
                        <span className="text-muted-foreground text-xs">
                          {t(`export.${mode}Hint`)}
                        </span>
                      </div>
                    </div>
                  ))}
                </RadioGroup>
              </fieldset>
            )}
          </div>
        ) : (
          <TransferStatus
            state={state}
            running={(progress) =>
              t("export.progress", {
                documents: progress?.documents ?? 0,
                size: formatBytes(progress?.bytes ?? 0),
              })
            }
            finished={(summary) => (
              <p className="text-success">
                {t("export.done", {
                  count: summary.documents ?? 0,
                  size: formatBytes(summary.bytes ?? 0),
                })}
              </p>
            )}
            cancelledText={t("export.cancelled")}
            failedText={(message) => t("export.failed", { message })}
            runningTitle={t("export.running")}
          />
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
              <Button
                onClick={() => void submit()}
                disabled={format === "csv" && fields.size === 0}
              >
                {t("export.submit")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
