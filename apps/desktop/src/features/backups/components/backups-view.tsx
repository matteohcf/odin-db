import type {
  BackupRun,
  BackupSchedule,
  ConnectionInfo,
  ConnectionProfile,
  ProfileId,
} from "@odin-db/bindings";
import { commands } from "@odin-db/bindings";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@odin-db/ui/components/alert-dialog";
import { Badge } from "@odin-db/ui/components/badge";
import { Button } from "@odin-db/ui/components/button";
import { Checkbox } from "@odin-db/ui/components/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@odin-db/ui/components/dropdown-menu";
import { Label } from "@odin-db/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@odin-db/ui/components/select";
import { Switch } from "@odin-db/ui/components/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@odin-db/ui/components/tooltip";
import { cn } from "@odin-db/ui/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock,
  CircleAlert,
  CircleCheck,
  CircleSlash,
  FolderOpen,
  HardDriveDownload,
  Loader2,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { RestoreDialog } from "@/features/backup";
import { useConnections, useProfiles } from "@/features/connections";
import { formatBytes, formatCount, formatRelativeTime } from "@/lib/format";
import { call, errorMessage } from "@/lib/ipc";
import {
  useBackupEvents,
  useBackupRuns,
  useBackupSchedules,
  useDeleteRun,
  useDeleteSchedule,
  useRunScheduleNow,
  useSaveSchedule,
} from "../api/backups";
import { durationLabel, scopeLabel, timingLabel } from "../lib/describe";
import { ScheduleDialog } from "./schedule-dialog";

const ALL = "all";
const NO_PROFILES: ConnectionProfile[] = [];
const NO_CONNECTIONS: ConnectionInfo[] = [];

/** Backup schedules and the history of every backup, across connections. */
export function BackupsView() {
  const { t } = useTranslation("backups");
  useBackupEvents();
  const profiles = useProfiles().data ?? NO_PROFILES;
  const schedules = useBackupSchedules();
  const runs = useBackupRuns();
  const [editing, setEditing] = useState<BackupSchedule | "new" | null>(null);
  const [filter, setFilter] = useState<string>(ALL);
  const nameOf = (id: ProfileId) =>
    profiles.find((p) => p.id === id)?.name ?? t("deletedConnection");

  const visibleRuns = (runs.data ?? []).filter((run) => filter === ALL || run.profileId === filter);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-6">
        <header className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="font-semibold text-lg">{t("title")}</h1>
            <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
          </div>
          <Button size="sm" onClick={() => setEditing("new")} disabled={profiles.length === 0}>
            <Plus />
            {t("schedule.new")}
          </Button>
        </header>

        <section aria-labelledby="schedules-heading" className="flex flex-col gap-3">
          <h2 id="schedules-heading" className="font-medium text-sm">
            {t("schedules")}
          </h2>
          {schedules.data?.length === 0 ? (
            <EmptyCard icon={CalendarClock} title={t("noSchedules")} body={t("noSchedulesBody")} />
          ) : (
            <ul className="grid gap-3 md:grid-cols-2">
              {(schedules.data ?? []).map((schedule) => (
                <li key={schedule.id}>
                  <ScheduleCard
                    schedule={schedule}
                    profileName={nameOf(schedule.profileId)}
                    onEdit={() => setEditing(schedule)}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="history-heading" className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h2 id="history-heading" className="font-medium text-sm">
              {t("history")}
            </h2>
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger size="sm" className="w-56" aria-label={t("filterConnection")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("allConnections")}</SelectItem>
                {profiles.map((profile) => (
                  <SelectItem key={profile.id} value={profile.id}>
                    {profile.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {runs.isPending ? (
            <p className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="size-4 animate-spin" />
            </p>
          ) : visibleRuns.length === 0 ? (
            <EmptyCard icon={HardDriveDownload} title={t("noBackups")} body={t("noBackupsBody")} />
          ) : (
            <HistoryTable runs={visibleRuns} nameOf={nameOf} />
          )}
        </section>
      </div>

      {editing && (
        <ScheduleDialog
          profiles={profiles}
          schedule={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function EmptyCard({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof CalendarClock;
  title: string;
  body: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-dashed p-4">
      <Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
      <div className="flex flex-col gap-0.5">
        <p className="font-medium text-sm">{title}</p>
        <p className="text-muted-foreground text-xs leading-relaxed">{body}</p>
      </div>
    </div>
  );
}

function ScheduleCard({
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

function HistoryTable({
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
      <table className="w-full text-sm">
        <thead className="bg-sidebar text-left text-muted-foreground text-xs">
          <tr className="border-b">
            <th className="px-3 py-2 font-medium">{t("columns.when")}</th>
            <th className="px-3 py-2 font-medium">{t("columns.what")}</th>
            <th className="px-3 py-2 font-medium">{t("columns.status")}</th>
            <th className="px-3 py-2 text-right font-medium">{t("columns.size")}</th>
            <th className="px-3 py-2 text-right font-medium">{t("columns.documents")}</th>
            <th className="px-3 py-2 text-right font-medium">{t("columns.duration")}</th>
            <th className="w-10 px-2 py-2" />
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => {
            const started = run.startedAt ?? 0;
            return (
              <tr
                key={run.id}
                className="border-b border-border/60 last:border-0 hover:bg-accent/40"
              >
                <td className="px-3 py-2 align-top">
                  <div className="flex flex-col">
                    <span title={new Date(started).toLocaleString(locale)}>
                      {formatRelativeTime(started, now, locale)}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {run.scheduleId ? t("trigger.scheduled") : t("trigger.manual")}
                    </span>
                  </div>
                </td>
                <td className="max-w-72 px-3 py-2 align-top">
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate">{nameOf(run.profileId)}</span>
                    <span className="truncate text-muted-foreground text-xs">
                      {scopeLabel(run.scope, t)}
                    </span>
                  </div>
                </td>
                <td className="px-3 py-2 align-top">
                  <StatusBadge run={run} />
                </td>
                <td className="px-3 py-2 text-right align-top tabular-nums">
                  {run.status === "completed" ? formatBytes(run.bytes ?? 0, locale) : "—"}
                </td>
                <td className="px-3 py-2 text-right align-top tabular-nums">
                  {run.status === "completed" ? formatCount(run.documents ?? 0, locale) : "—"}
                </td>
                <td className="px-3 py-2 text-right align-top tabular-nums">
                  {run.finishedAt ? durationLabel(run.finishedAt - started) : "—"}
                </td>
                <td className="px-2 py-1.5 align-top">
                  <RunMenu
                    run={run}
                    onRestore={() => setRestoring(run)}
                    onDelete={() => setDeleting(run)}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
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
        <Badge variant="secondary" className="gap-1 text-success">
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
            <Badge variant="secondary" className="gap-1 text-destructive">
              <CircleAlert className="size-3" />
              {t("status.failed")}
            </Badge>
          </TooltipTrigger>
          <TooltipContent className="max-w-80 selectable">{run.error}</TooltipContent>
        </Tooltip>
      );
  }
}

function RunMenu({
  run,
  onRestore,
  onDelete,
}: {
  run: BackupRun;
  onRestore: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation("backups");
  const usable = run.status === "completed" && run.archiveExists;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-7" aria-label={t("run.actions")}>
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem disabled={!usable} onSelect={onRestore}>
          <RotateCcw />
          {t("run.restore")}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!usable}
          onSelect={() =>
            void call(commands.revealBackup(run.id)).catch((error: unknown) =>
              toast.error(errorMessage(error)),
            )
          }
        >
          <FolderOpen />
          {t("run.reveal")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          disabled={run.status === "running"}
          onSelect={onDelete}
        >
          <Trash2 />
          {t("run.delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DeleteRunDialog({ run, onClose }: { run: BackupRun; onClose: () => void }) {
  const { t } = useTranslation("backups");
  const remove = useDeleteRun();
  const [deleteArchive, setDeleteArchive] = useState(run.archiveExists);
  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("run.deleteTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t("run.deleteBody")}</AlertDialogDescription>
        </AlertDialogHeader>
        {run.archiveExists && (
          <div className="flex items-start gap-2">
            <Checkbox
              id="delete-archive"
              checked={deleteArchive}
              onCheckedChange={(checked) => setDeleteArchive(checked === true)}
            />
            <Label
              htmlFor="delete-archive"
              className="flex flex-col items-start gap-0.5 font-normal"
            >
              <span>{t("run.deleteArchive")}</span>
              <span className="break-all font-mono text-muted-foreground text-xs">
                {run.archive}
              </span>
            </Label>
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>{t("actions.cancel", { ns: "common" })}</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={remove.isPending}
            onClick={() =>
              remove.mutate({ id: run.id, deleteArchive }, { onSuccess: () => onClose() })
            }
          >
            {t("run.delete")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Restores a history backup into its own connection, or another connected one. */
function RestoreFromBackup({ run, onClose }: { run: BackupRun; onClose: () => void }) {
  const { t } = useTranslation("backups");
  const queryClient = useQueryClient();
  const profiles = useProfiles().data ?? NO_PROFILES;
  const connections = useConnections().data ?? NO_CONNECTIONS;
  const writable = connections.filter((connection) => !connection.readOnly);
  const [target, setTarget] = useState<ConnectionInfo | null>(null);
  const [source, setSource] = useState<{ token: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const nameOf = (id: ProfileId) => profiles.find((p) => p.id === id)?.name ?? "";

  async function start(connection: ConnectionInfo) {
    try {
      setSource(await call(commands.restoreSourceFromBackup(run.id)));
      setTarget(connection);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  if (target && source) {
    return (
      <RestoreDialog
        connectionId={target.id}
        profileName={nameOf(target.profileId)}
        readOnly={target.readOnly}
        database={run.scope.kind === "deployment" ? undefined : run.scope.database}
        initialSource={source}
        onRestored={() =>
          void queryClient.invalidateQueries({ queryKey: ["connections", target.id] })
        }
        onClose={onClose}
      />
    );
  }

  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("restore.title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {writable.length === 0 ? t("restore.noConnection") : t("restore.choose")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="flex flex-col gap-1">
          {writable.map((connection) => (
            <li key={connection.id}>
              <Button
                variant="outline"
                className="w-full justify-start"
                onClick={() => void start(connection)}
              >
                {nameOf(connection.profileId)}
                {connection.profileId === run.profileId && (
                  <span className="ml-auto text-muted-foreground text-xs">
                    {t("restore.original")}
                  </span>
                )}
              </Button>
            </li>
          ))}
        </ul>
        {error && <p className="text-destructive text-xs">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel>{t("actions.cancel", { ns: "common" })}</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
