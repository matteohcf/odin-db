import type { BackupSchedule } from "@odin-db/bindings";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@odin-db/ui/components/alert-dialog";
import { Button } from "@odin-db/ui/components/button";
import { Switch } from "@odin-db/ui/components/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@odin-db/ui/components/tooltip";
import { cn } from "@odin-db/ui/lib/utils";
import { Pencil, Play, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { formatRelativeTime } from "@/lib/format";
import { useDeleteSchedule, useRunScheduleNow, useSaveSchedule } from "../api/backups";
import { scopeLabel, timingLabel } from "../lib/describe";

export function ScheduleCard({
  schedule,
  profileName,
  onEdit,
}: {
  schedule: BackupSchedule;
  profileName: string;
  onEdit: () => void;
}) {
  const { t, i18n } = useTranslation("backups");
  const save = useSaveSchedule();
  const remove = useDeleteSchedule();
  const runNow = useRunScheduleNow();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const now = Date.now();

  function toggle(enabled: boolean) {
    save.mutate({
      id: schedule.id,
      input: {
        profileId: schedule.profileId,
        scope: schedule.scope,
        timing: schedule.timing,
        keep: schedule.keep,
        enabled,
      },
      folderToken: null,
    });
  }

  return (
    <article
      className={cn(
        "flex h-full flex-col gap-3 rounded-lg border bg-card p-4",
        !schedule.enabled && "opacity-70",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="truncate font-medium text-sm">{profileName}</p>
          <p className="truncate text-muted-foreground text-xs">{scopeLabel(schedule.scope, t)}</p>
        </div>
        {/* The span keeps the tooltip's data-state off the switch (see CLAUDE.md). */}
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <Switch
                checked={schedule.enabled}
                onCheckedChange={toggle}
                aria-label={t("schedule.enabled")}
              />
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {schedule.enabled ? t("schedule.pause") : t("schedule.resume")}
          </TooltipContent>
        </Tooltip>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">{t("card.when")}</dt>
        <dd>{timingLabel(schedule.timing, t, i18n.language)}</dd>
        <dt className="text-muted-foreground">{t("card.next")}</dt>
        <dd
          title={
            schedule.nextRunAt
              ? new Date(schedule.nextRunAt).toLocaleString(i18n.language)
              : undefined
          }
        >
          {schedule.nextRunAt
            ? formatRelativeTime(schedule.nextRunAt, now, i18n.language)
            : t("card.paused")}
        </dd>
        <dt className="text-muted-foreground">{t("card.keeps")}</dt>
        <dd>{t("card.keepsValue", { count: schedule.keep })}</dd>
        <dt className="text-muted-foreground">{t("card.folder")}</dt>
        <dd className="truncate font-mono" title={schedule.folder}>
          {schedule.folder}
        </dd>
      </dl>
      <div className="mt-auto flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          disabled={runNow.isPending}
          onClick={() =>
            runNow.mutate(schedule.id, { onSuccess: () => toast.success(t("schedule.started")) })
          }
        >
          <Play />
          {t("schedule.runNow")}
        </Button>
        <Button variant="ghost" size="sm" onClick={onEdit}>
          <Pencil />
          {t("schedule.edit")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto text-muted-foreground hover:text-destructive"
          onClick={() => setConfirmDelete(true)}
          aria-label={t("schedule.delete")}
        >
          <Trash2 />
        </Button>
      </div>
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("schedule.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("schedule.deleteBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("actions.cancel", { ns: "common" })}</AlertDialogCancel>
            <Button variant="destructive" onClick={() => remove.mutate(schedule.id)}>
              {t("schedule.delete")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  );
}
