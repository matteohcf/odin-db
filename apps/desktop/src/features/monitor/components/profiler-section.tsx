import {
  type ConnectionInfo,
  commands,
  type ProfileEntry,
  type ProfilingLevel,
} from "@odin-db/bindings";
import { Button } from "@odin-db/ui/components/button";
import { Input } from "@odin-db/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@odin-db/ui/components/select";
import { cn } from "@odin-db/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { call, errorMessage } from "@/lib/ipc";
import { indexHint } from "../lib/profile";
import { ProfileEntryDialog } from "./profile-entry-dialog";

const LEVELS: ProfilingLevel[] = ["off", "slow", "all"];

interface ProfilerSectionProps {
  connection: ConnectionInfo;
  /** The monitor's refresh interval, or `false` while paused or hidden. */
  polling: number | false;
}

/** The database profiler: what it records, and the slow operations it caught. */
export function ProfilerSection({ connection, polling }: ProfilerSectionProps) {
  const { t, i18n } = useTranslation("monitor");
  const queryClient = useQueryClient();
  const [database, setDatabase] = useState<string>("");
  const [slowMs, setSlowMs] = useState("");
  const [selected, setSelected] = useState<ProfileEntry | null>(null);

  const databases = useQuery({
    queryKey: ["profiler-databases", connection.id],
    queryFn: () => call(commands.listDatabases(connection.id)),
  });
  // The first user database, rather than admin or local.
  useEffect(() => {
    if (database || !databases.data) return;
    const first = databases.data.find(
      (entry) => !["admin", "config", "local"].includes(entry.name),
    );
    if (first) setDatabase(first.name);
  }, [database, databases.data]);

  const statusKey = ["profiling-status", connection.id, database];
  const status = useQuery({
    queryKey: statusKey,
    queryFn: () => call(commands.profilingStatus(connection.id, database)),
    enabled: database !== "",
    retry: false,
  });
  useEffect(() => {
    if (status.data) setSlowMs(String(status.data.slowMs ?? 100));
  }, [status.data]);
  const recording = status.data !== undefined && status.data.level !== "off";

  const entries = useQuery({
    queryKey: ["profile-entries", connection.id, database],
    queryFn: () =>
      call(commands.profileEntries(connection.id, { database, collection: null, minMillis: null })),
    enabled: database !== "",
    refetchInterval: recording ? polling : false,
  });

  const change = useMutation({
    mutationFn: (level: ProfilingLevel) =>
      call(
        commands.setProfilingStatus(connection.id, database, {
          level,
          slowMs: Math.max(0, Number(slowMs) || 0),
        }),
      ),
    meta: { handlesErrors: true },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: statusKey }),
    onError: (error) => toast.error(errorMessage(error)),
  });

  const number = (value: number | null) =>
    value === null ? "—" : value.toLocaleString(i18n.language);
  const level = status.data?.level ?? "off";

  return (
    <section className="mt-6 flex flex-col gap-2" aria-label={t("profiler.title")}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto font-semibold text-sm">{t("profiler.title")}</h2>
        <Select value={database} onValueChange={setDatabase}>
          <SelectTrigger size="sm" className="w-44" aria-label={t("profiler.database")}>
            <SelectValue placeholder={t("profiler.database")} />
          </SelectTrigger>
          <SelectContent>
            {databases.data?.map((entry) => (
              <SelectItem key={entry.name} value={entry.name}>
                {entry.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={level}
          onValueChange={(next) => change.mutate(next as ProfilingLevel)}
          disabled={!status.data || connection.readOnly || change.isPending}
        >
          <SelectTrigger
            size="sm"
            className="w-44"
            aria-label={t("profiler.level")}
            title={connection.readOnly ? t("profiler.readOnly") : undefined}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LEVELS.map((option) => (
              <SelectItem key={option} value={option}>
                {t(`profiler.levels.${option}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1">
          <Input
            aria-label={t("profiler.threshold")}
            value={slowMs}
            onChange={(event) => setSlowMs(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && change.mutate(level)}
            inputMode="numeric"
            disabled={!status.data || connection.readOnly}
            className="h-8 w-20 text-right text-xs tabular-nums"
          />
          <span className="text-muted-foreground text-xs">ms</span>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("profiler.refresh")}
          onClick={() => void entries.refetch()}
          disabled={!database}
        >
          <RefreshCw className={cn(entries.isFetching && "animate-spin")} />
        </Button>
      </div>
      {status.error ? (
        <p role="alert" className="text-destructive text-xs selectable">
          {t("profiler.unavailable", { message: errorMessage(status.error) })}
        </p>
      ) : entries.data?.length === 0 ? (
        <p className="rounded-lg border p-6 text-center text-muted-foreground text-sm">
          {recording ? t("profiler.empty") : t("profiler.off")}
        </p>
      ) : (
        <div className="max-h-96 overflow-auto rounded-lg border">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">{t("profiler.when")}</th>
                <th className="px-3 py-2 font-medium">{t("ops.op")}</th>
                <th className="px-3 py-2 font-medium">{t("ops.namespace")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("profiler.duration")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("profiler.examined")}</th>
                <th className="px-3 py-2 font-medium">{t("profiler.plan")}</th>
              </tr>
            </thead>
            <tbody>
              {entries.data?.map((entry, index) => {
                const hint = indexHint(entry);
                return (
                  <tr
                    // Entries have no id; the time and position are unique enough within a list.
                    key={`${entry.at}-${index}`}
                    tabIndex={0}
                    onClick={() => setSelected(entry)}
                    onKeyDown={(event) => event.key === "Enter" && setSelected(entry)}
                    className="cursor-pointer border-t outline-none hover:bg-accent/50 focus-visible:bg-accent"
                  >
                    <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground tabular-nums">
                      {new Date(entry.at ?? 0).toLocaleTimeString(i18n.language)}
                    </td>
                    <td className="px-3 py-1.5 font-medium">{entry.op}</td>
                    <td className="px-3 py-1.5 font-mono">{entry.ns}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {number(entry.millis)} ms
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">
                      {number(entry.docsExamined)} / {number(entry.returned)}
                    </td>
                    <td
                      className="max-w-56 truncate px-3 py-1.5 font-mono"
                      title={entry.planSummary ?? ""}
                    >
                      <span className={cn(hint && "text-warning")}>{entry.planSummary ?? "—"}</span>
                      {hint && (
                        <span className="ml-1.5 font-sans text-warning">
                          {t(`profiler.hints.${hint}`)}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {selected && <ProfileEntryDialog entry={selected} onClose={() => setSelected(null)} />}
    </section>
  );
}
