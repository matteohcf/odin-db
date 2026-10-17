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
import { Label } from "@odin-db/ui/components/label";
import { CircleAlert, Loader2 } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { call } from "@/lib/ipc";
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

  const submit = () =>
    run.start((channel) => call(commands.backupDatabase(connectionId, { scope, gzip }, channel)));

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("backup.title", { target })}</DialogTitle>
          <DialogDescription>{t("backup.description")}</DialogDescription>
        </DialogHeader>

        <ToolsGate>
          {state.status === "idle" ? (
            <div className="flex items-start gap-2.5">
              <Checkbox
                id={`${id}-gzip`}
                checked={gzip}
                onCheckedChange={(checked) => setGzip(checked === true)}
                className="mt-0.5"
              />
              <div className="flex flex-col gap-0.5">
                <Label htmlFor={`${id}-gzip`} className="font-normal">
                  {t("backup.gzip")}
                </Label>
                <span className="text-muted-foreground text-xs">{t("backup.gzipHint")}</span>
              </div>
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
              <Button onClick={() => void submit()}>{t("backup.submit")}</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
