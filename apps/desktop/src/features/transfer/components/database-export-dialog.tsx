import {
  type ConnectionId,
  commands,
  type DatabaseProgress,
  type DatabaseTransferSummary,
  type JsonMode,
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
import { Loader2 } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { call } from "@/lib/ipc";
import { useTransfer } from "../hooks/use-transfer";
import { TransferStatus } from "./transfer-status";

interface DatabaseExportDialogProps {
  connectionId: ConnectionId;
  database: string;
  /** Exportable collections (no views); `undefined` while loading. */
  collections: readonly string[] | undefined;
  onClose: () => void;
}

const FORMATS = ["jsonArray", "ndjson"] as const;

/** Exports a whole database, one file per collection. */
export function DatabaseExportDialog({
  connectionId,
  database,
  collections,
  onClose,
}: DatabaseExportDialogProps) {
  const { t } = useTranslation("transfer");
  const id = useId();
  const [format, setFormat] = useState<(typeof FORMATS)[number]>("ndjson");
  const [jsonMode, setJsonMode] = useState<JsonMode>("canonical");
  const [selected, setSelected] = useState<ReadonlySet<string> | null>(null);
  const transfer = useTransfer<DatabaseTransferSummary, DatabaseProgress>();
  const { state } = transfer;
  const busy = state.status === "running";
  const done =
    state.status === "finished" || state.status === "cancelled" || state.status === "failed";

  useEffect(() => {
    if (collections && !selected) setSelected(new Set(collections));
  }, [collections, selected]);

  const chosen = collections?.filter((name) => selected?.has(name)) ?? [];

  const submit = () =>
    transfer.start((channel) =>
      call(
        commands.exportDatabase(
          connectionId,
          database,
          {
            format,
            jsonMode,
            // Empty means "all", which also picks up collections created meanwhile.
            collections: chosen.length === collections?.length ? [] : chosen,
          },
          channel,
        ),
      ),
    );

  const toggle = (name: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(name);
      else next.delete(name);
      return next;
    });

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[calc(100vh-3rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("database.export.title")}</DialogTitle>
          <DialogDescription>{t("database.export.description", { database })}</DialogDescription>
        </DialogHeader>

        {state.status === "idle" ? (
          <div className="flex flex-col gap-5">
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 font-medium text-sm">{t("export.format")}</legend>
              <div className="grid grid-cols-2 gap-2">
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

            <fieldset className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <legend className="font-medium text-sm">
                  {t("database.export.collections")}
                  {collections && (
                    <span className="ml-1.5 font-normal text-muted-foreground text-xs">
                      {chosen.length}/{collections.length}
                    </span>
                  )}
                </legend>
                {collections && collections.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs"
                    onClick={() =>
                      setSelected(
                        chosen.length === collections.length ? new Set() : new Set(collections),
                      )
                    }
                  >
                    {chosen.length === collections.length
                      ? t("database.export.noneSelected")
                      : t("database.export.all")}
                  </Button>
                )}
              </div>
              {!collections ? (
                <p className="flex items-center gap-2 text-muted-foreground text-xs">
                  <Loader2 className="size-3.5 animate-spin" />
                  {t("database.export.loading")}
                </p>
              ) : collections.length === 0 ? (
                <p className="text-muted-foreground text-xs">{t("database.export.none")}</p>
              ) : (
                <div className="grid max-h-48 grid-cols-2 gap-x-4 gap-y-1.5 overflow-y-auto rounded-md border p-2.5">
                  {collections.map((name) => (
                    <div key={name} className="flex items-center gap-2">
                      <Checkbox
                        id={`${id}-c-${name}`}
                        checked={selected?.has(name) ?? false}
                        onCheckedChange={(checked) => toggle(name, checked === true)}
                      />
                      <Label
                        htmlFor={`${id}-c-${name}`}
                        className="truncate font-mono font-normal text-xs"
                      >
                        {name}
                      </Label>
                    </div>
                  ))}
                </div>
              )}
            </fieldset>
          </div>
        ) : (
          <TransferStatus
            state={state}
            runningTitle={t("database.export.running")}
            running={(progress) =>
              progress
                ? t("database.export.progress", {
                    collection: progress.collection,
                    index: progress.index ?? 0,
                    total: progress.total ?? 0,
                    documents: progress.documents ?? 0,
                  })
                : ""
            }
            finished={(summary) => (
              <p className="text-success">
                {t("database.export.done", {
                  collections: summary.collections ?? 0,
                  documents: summary.documents ?? 0,
                })}
              </p>
            )}
            cancelledText={t("database.export.cancelled")}
            failedText={(message) => t("database.export.failed", { message })}
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
              <Button onClick={() => void submit()} disabled={chosen.length === 0}>
                {t("database.export.submit")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
