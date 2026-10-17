import { type BackupScope, type ConnectionId, commands } from "@odin-db/bindings";
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
import { useQuery } from "@tanstack/react-query";
import { CircleAlert, Loader2 } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { call, errorMessage } from "@/lib/ipc";
import { parseShellDocument } from "@/lib/shell-syntax";
import { useToolRun } from "../hooks/use-tool-run";
import { ToolLog } from "./tool-log";
import { ToolsGate } from "./tools-gate";

interface BackupDialogProps {
  connectionId: ConnectionId;
  profileName: string;
  scope: BackupScope;
  onClose: () => void;
}

export function BackupDialog({ connectionId, profileName, scope, onClose }: BackupDialogProps) {
  const { t } = useTranslation("backup");
  const id = useId();
  const [gzip, setGzip] = useState(true);
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [oplog, setOplog] = useState(false);
  const [optionError, setOptionError] = useState<string | null>(null);
  const database = scope.kind === "deployment" ? null : scope.database;
  const collections = useQuery({
    // The tree's key, so an expanded database is already cached.
    queryKey: ["connections", connectionId, "databases", database ?? "", "collections"],
    queryFn: () => call(commands.listCollections(connectionId, database ?? "")),
    enabled: scope.kind === "database",
  });
  const backupable = (collections.data ?? []).filter(
    (collection) => collection.kind !== "view" && !collection.name.startsWith("system."),
  );
  const run = useToolRun();
  const { state, summary } = run;
  const busy = state.status === "running";
  const done = state.status !== "idle" && !busy;

  const target =
    scope.kind === "deployment"
      ? t("scope.deployment", { name: profileName })
      : scope.kind === "database"
        ? t("scope.database", { database: scope.database })
        : t("scope.collection", { database: scope.database, collection: scope.collection });

  async function submit() {
    setOptionError(null);
    let query = null;
    if (scope.kind === "collection" && filter.trim() !== "") {
      try {
        query = await parseShellDocument(filter);
      } catch (error) {
        setOptionError(errorMessage(error));
        return;
      }
    }
    const request = {
      scope,
      gzip,
      excludeCollections: scope.kind === "database" ? [...excluded] : [],
      query,
      oplog: scope.kind === "deployment" && oplog,
    };
    await run.start((channel) => call(commands.backupDatabase(connectionId, request, channel)));
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("backup.title", { target })}</DialogTitle>
          <DialogDescription>{t("backup.description")}</DialogDescription>
        </DialogHeader>

        <ToolsGate>
          {state.status === "idle" ? (
            <div className="flex flex-col gap-4">
              <Option
                id={`${id}-gzip`}
                checked={gzip}
                onChange={setGzip}
                label={t("backup.gzip")}
                hint={t("backup.gzipHint")}
              />
              {scope.kind === "deployment" && (
                <Option
                  id={`${id}-oplog`}
                  checked={oplog}
                  onChange={setOplog}
                  label={t("backup.oplog")}
                  hint={t("backup.oplogHint")}
                />
              )}
              {scope.kind === "database" && backupable.length > 0 && (
                <fieldset className="flex flex-col gap-1.5">
                  <legend className="mb-1.5 font-medium text-sm">
                    {t("backup.collections", {
                      selected: backupable.length - excluded.size,
                      total: backupable.length,
                    })}
                  </legend>
                  <ul className="grid max-h-40 grid-cols-2 gap-x-3 gap-y-1 overflow-y-auto rounded-md border p-2">
                    {backupable.map((collection) => (
                      <li key={collection.name} className="flex min-w-0 items-center gap-2">
                        <Checkbox
                          id={`${id}-c-${collection.name}`}
                          checked={!excluded.has(collection.name)}
                          onCheckedChange={(checked) =>
                            setExcluded((current) => {
                              const next = new Set(current);
                              if (checked === true) next.delete(collection.name);
                              else next.add(collection.name);
                              return next;
                            })
                          }
                        />
                        <Label
                          htmlFor={`${id}-c-${collection.name}`}
                          className="truncate font-mono font-normal text-xs"
                        >
                          {collection.name}
                        </Label>
                      </li>
                    ))}
                  </ul>
                </fieldset>
              )}
              {scope.kind === "collection" && (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`${id}-filter`}>{t("backup.filter")}</Label>
                  <Input
                    id={`${id}-filter`}
                    value={filter}
                    onChange={(event) => setFilter(event.target.value)}
                    placeholder={t("backup.filterPlaceholder")}
                    className="font-mono text-xs"
                    spellCheck={false}
                    autoComplete="off"
                  />
                  <span className="text-muted-foreground text-xs">{t("backup.filterHint")}</span>
                </div>
              )}
              {optionError && (
                <p
                  role="alert"
                  className="flex items-start gap-1.5 text-destructive text-xs selectable"
                >
                  <CircleAlert className="mt-px size-3.5 shrink-0" />
                  {optionError}
                </p>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {busy && (
                <p role="status" className="flex items-center gap-2 font-medium text-sm">
                  <Loader2 className="size-4 animate-spin text-primary" />
                  {t("backup.running")}
                </p>
              )}
              {state.status === "completed" && summary && (
                <p className="text-sm text-success">
                  {t("backup.done", {
                    collections: summary.collections ?? 0,
                    documents: summary.documents ?? 0,
                  })}
                </p>
              )}
              {state.status === "cancelled" && (
                <p className="text-muted-foreground text-sm">{t("backup.cancelled")}</p>
              )}
              {state.status === "failed" && (
                <p
                  role="alert"
                  className="flex items-start gap-2 text-destructive text-sm selectable"
                >
                  <CircleAlert className="mt-0.5 size-4 shrink-0" />
                  {t("backup.failed", { message: state.error })}
                </p>
              )}
              <ToolLog lines={run.lines} />
            </div>
          )}
        </ToolsGate>

        <DialogFooter>
          {busy ? (
            <Button variant="outline" onClick={run.cancel}>
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
                disabled={
                  scope.kind === "database" &&
                  backupable.length > 0 &&
                  excluded.size === backupable.length
                }
              >
                {t("backup.submit")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Option({
  id,
  checked,
  onChange,
  label,
  hint,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(value) => onChange(value === true)}
        className="mt-0.5"
      />
      <div className="flex flex-col gap-0.5">
        <Label htmlFor={id} className="font-normal">
          {label}
        </Label>
        <span className="text-muted-foreground text-xs">{hint}</span>
      </div>
    </div>
  );
}
