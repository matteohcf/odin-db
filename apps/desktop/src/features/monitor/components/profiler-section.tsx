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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@odin-db/ui/components/table";
import { cn } from "@odin-db/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { InlineError } from "@/components/inline-error";
import { useTabs } from "@/features/workspace";
import { call, errorMessage } from "@/lib/ipc";
import { indexHint } from "../lib/profile";
import { MonitorSection } from "./monitor-section";
import { ProfileEntryDialog } from "./profile-entry-dialog";
import { SectionNote } from "./section-note";

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
  const openCollection = useTabs((s) => s.openCollection);

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
    <MonitorSection
      title={t("profiler.title")}
      actions={
        <>
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
        </>
      }
    >
      {status.error ? (
        <InlineError>
          {t("profiler.unavailable", { message: errorMessage(status.error) })}
        </InlineError>
      ) : entries.data?.length === 0 ? (
        <SectionNote>{recording ? t("profiler.empty") : t("profiler.off")}</SectionNote>
      ) : (
        <div className="max-h-96 overflow-auto rounded-lg border">
          <Table>
            <TableHeader className="sticky top-0 bg-muted">
              <TableRow className="hover:bg-transparent">
                <TableHead>{t("profiler.when")}</TableHead>
                <TableHead>{t("ops.op")}</TableHead>
                <TableHead>{t("ops.namespace")}</TableHead>
                <TableHead className="text-right">{t("profiler.duration")}</TableHead>
                <TableHead className="text-right">{t("profiler.examined")}</TableHead>
                <TableHead>{t("profiler.plan")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.data?.map((entry, index) => {
                const hint = indexHint(entry);
                return (
                  <TableRow
                    // Entries have no id; the time and position are unique enough within a list.
                    key={`${entry.at}-${index}`}
                    tabIndex={0}
                    onClick={() => setSelected(entry)}
                    onKeyDown={(event) => event.key === "Enter" && setSelected(entry)}
                    className="cursor-pointer border-t outline-none hover:bg-accent/50 focus-visible:bg-accent"
                  >
                    <TableCell className="whitespace-nowrap py-1.5 text-muted-foreground tabular-nums">
                      {new Date(entry.at ?? 0).toLocaleTimeString(i18n.language)}
                    </TableCell>
                    <TableCell className="py-1.5 font-medium">{entry.op}</TableCell>
                    <TableCell className="py-1.5 font-mono">{entry.ns}</TableCell>
                    <TableCell className="py-1.5 text-right tabular-nums">
                      {number(entry.millis)} ms
                    </TableCell>
                    <TableCell className="whitespace-nowrap py-1.5 text-right tabular-nums">
                      {number(entry.docsExamined)} / {number(entry.returned)}
                    </TableCell>
                    <TableCell
                      className="max-w-56 truncate px-3 py-1.5 font-mono"
                      title={entry.planSummary ?? ""}
                    >
                      <span className={cn(hint && "text-warning")}>{entry.planSummary ?? "—"}</span>
                      {hint && (
                        <span className="ml-1.5 font-sans text-warning">
                          {t(`profiler.hints.${hint}`)}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      {selected && (
        <ProfileEntryDialog
          entry={selected}
          onOpenQuery={(query) =>
            openCollection(
              {
                profileId: connection.profileId,
                database: query.database,
                collection: query.collection,
                collectionKind: "collection",
              },
              false,
              { filter: query.filter, sort: query.sort },
            )
          }
          onClose={() => setSelected(null)}
        />
      )}
    </MonitorSection>
  );
}
