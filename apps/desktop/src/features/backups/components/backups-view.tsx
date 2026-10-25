import type { BackupSchedule, ConnectionProfile, ProfileId } from "@odin-db/bindings";
import { Button } from "@odin-db/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@odin-db/ui/components/select";
import { CalendarClock, HardDriveDownload, Loader2, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/page-header";
import { useProfiles } from "@/features/connections";
import { useBackupEvents, useBackupRuns, useBackupSchedules } from "../api/backups";
import { HistoryTable } from "./history-table";
import { ScheduleCard } from "./schedule-card";
import { ScheduleDialog } from "./schedule-dialog";

const ALL = "all";
const NO_PROFILES: ConnectionProfile[] = [];

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
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader icon={HardDriveDownload} title={t("title")} subtitle={t("subtitle")}>
        <Button size="sm" onClick={() => setEditing("new")} disabled={profiles.length === 0}>
          <Plus />
          {t("schedule.new")}
        </Button>
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-6">
          <section aria-labelledby="schedules-heading" className="flex flex-col gap-3">
            <h2 id="schedules-heading" className="font-medium text-sm">
              {t("schedules")}
            </h2>
            {schedules.data?.length === 0 ? (
              <EmptyCard
                icon={CalendarClock}
                title={t("noSchedules")}
                body={t("noSchedulesBody")}
              />
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
              <EmptyCard
                icon={HardDriveDownload}
                title={t("noBackups")}
                body={t("noBackupsBody")}
              />
            ) : (
              <HistoryTable runs={visibleRuns} nameOf={nameOf} />
            )}
          </section>
        </div>
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
