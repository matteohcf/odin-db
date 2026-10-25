import type { BackupRun, ProfileId } from "@odin-db/bindings";
import { Badge } from "@odin-db/ui/components/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@odin-db/ui/components/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@odin-db/ui/components/tooltip";
import { CircleAlert, CircleCheck, CircleSlash, Loader2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { formatBytes, formatCount, formatRelativeTime } from "@/lib/format";
import { durationLabel, scopeLabel } from "../lib/describe";
import { DeleteRunDialog } from "./delete-run-dialog";
import { RestoreFromBackup } from "./restore-from-backup";
import { RunMenu } from "./run-menu";

export function HistoryTable({
  runs,
  nameOf,
}: {
  runs: readonly BackupRun[];
  nameOf: (id: ProfileId) => string;
}) {
  const { t, i18n } = useTranslation("backups");
  const now = Date.now();
  const locale = i18n.language;
  const [restoring, setRestoring] = useState<BackupRun | null>(null);
  const [deleting, setDeleting] = useState<BackupRun | null>(null);

  return (
    <div className="overflow-hidden rounded-lg border">
      <Table className="text-sm">
        <TableHeader className="bg-sidebar text-xs">
          <TableRow className="border-b">
            <TableHead>{t("columns.when")}</TableHead>
            <TableHead>{t("columns.what")}</TableHead>
            <TableHead>{t("columns.status")}</TableHead>
            <TableHead className="text-right">{t("columns.size")}</TableHead>
            <TableHead className="text-right">{t("columns.documents")}</TableHead>
            <TableHead className="text-right">{t("columns.duration")}</TableHead>
            <th className="w-10 px-2 py-2" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((run) => {
            const started = run.startedAt ?? 0;
            return (
              <TableRow
                key={run.id}
                className="border-b border-border/60 last:border-0 hover:bg-accent/40"
              >
                <TableCell className="align-top">
                  <div className="flex flex-col">
                    <span title={new Date(started).toLocaleString(locale)}>
                      {formatRelativeTime(started, now, locale)}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {run.scheduleId ? t("trigger.scheduled") : t("trigger.manual")}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="max-w-72 align-top">
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate">{nameOf(run.profileId)}</span>
                    <span className="truncate text-muted-foreground text-xs">
                      {scopeLabel(run.scope, t)}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="align-top">
                  <StatusBadge run={run} />
                </TableCell>
                <TableCell className="text-right align-top tabular-nums">
                  {run.status === "completed" ? formatBytes(run.bytes ?? 0, locale) : "—"}
                </TableCell>
                <TableCell className="text-right align-top tabular-nums">
                  {run.status === "completed" ? formatCount(run.documents ?? 0, locale) : "—"}
                </TableCell>
                <TableCell className="text-right align-top tabular-nums">
                  {run.finishedAt ? durationLabel(run.finishedAt - started) : "—"}
                </TableCell>
                <TableCell className="px-2 py-1.5 align-top">
                  <RunMenu
                    run={run}
                    onRestore={() => setRestoring(run)}
                    onDelete={() => setDeleting(run)}
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {restoring && <RestoreFromBackup run={restoring} onClose={() => setRestoring(null)} />}
      {deleting && <DeleteRunDialog run={deleting} onClose={() => setDeleting(null)} />}
    </div>
  );
}

function StatusBadge({ run }: { run: BackupRun }) {
  const { t } = useTranslation("backups");
  switch (run.status) {
    case "running":
      return (
        <Badge variant="secondary" className="gap-1">
          <Loader2 className="size-3 animate-spin" />
          {t("status.running")}
        </Badge>
      );
    case "completed":
      return (
        <Badge variant="success" className="gap-1">
          <CircleCheck className="size-3" />
          {run.archiveExists ? t("status.completed") : t("status.fileMissing")}
        </Badge>
      );
    case "cancelled":
      return (
        <Badge variant="secondary" className="gap-1">
          <CircleSlash className="size-3" />
          {t("status.cancelled")}
        </Badge>
      );
    case "failed":
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="danger" className="gap-1">
              <CircleAlert className="size-3" />
              {t("status.failed")}
            </Badge>
          </TooltipTrigger>
          <TooltipContent className="max-w-80 selectable">{run.error}</TooltipContent>
        </Tooltip>
      );
  }
}
