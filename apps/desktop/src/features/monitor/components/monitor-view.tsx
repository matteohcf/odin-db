import {
  type ConnectionInfo,
  type CurrentOp,
  commands,
  type ServerStatus,
} from "@odin-db/bindings";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@odin-db/ui/components/alert-dialog";
import { Button } from "@odin-db/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@odin-db/ui/components/select";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, OctagonX, Pause, Play } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { compactEJson } from "@/lib/ejson-display";
import { formatBytes } from "@/lib/format";
import { call, errorMessage } from "@/lib/ipc";
import { type Rates, rates } from "../lib/rates";
import { Sparkline } from "./sparkline";

const HISTORY = 60;
const INTERVALS = [1000, 2000, 5000, 10000] as const;

interface MonitorViewProps {
  connection: ConnectionInfo;
  profileName: string;
  /** Polls only while the tab is the visible one. */
  active: boolean;
}

export function MonitorView({ connection, profileName, active }: MonitorViewProps) {
  const { t, i18n } = useTranslation("monitor");
  const queryClient = useQueryClient();
  const [interval, setIntervalMs] = useState<number>(2000);
  const [paused, setPaused] = useState(false);
  const [history, setHistory] = useState<{ sample: ServerStatus; rates: Rates | null }[]>([]);
  const [toKill, setToKill] = useState<CurrentOp | null>(null);
  const polling = active && !paused ? interval : false;

  const status = useQuery({
    queryKey: ["server-status", connection.id],
    queryFn: () => call(commands.serverStatus(connection.id)),
    refetchInterval: polling,
    refetchIntervalInBackground: false,
  });
  const ops = useQuery({
    queryKey: ["current-ops", connection.id],
    queryFn: () => call(commands.currentOps(connection.id)),
    refetchInterval: polling,
  });
  const kill = useMutation({
    mutationFn: (op: CurrentOp) => call(commands.killOp(connection.id, op.opid)),
    meta: { handlesErrors: true },
  });

  useEffect(() => {
    const sample = status.data;
    if (!sample) return;
    setHistory((current) => {
      const last = current.at(-1);
      if (last && last.sample.sampledAt === sample.sampledAt) return current;
      const entry = { sample, rates: last ? rates(last.sample, sample) : null };
      return [...current, entry].slice(-HISTORY);
    });
  }, [status.data]);

  const latest = history.at(-1);
  const current = latest?.sample;
  const currentRates = latest?.rates;
  const opsSeries = history.map((entry) => entry.rates?.totalOps ?? 0);
  const netSeries = history.map(
    (entry) => (entry.rates?.bytesInPerSecond ?? 0) + (entry.rates?.bytesOutPerSecond ?? 0),
  );
  const number = (value: number) =>
    value.toLocaleString(i18n.language, { maximumFractionDigits: value < 10 ? 1 : 0 });

  async function confirmKill() {
    if (!toKill) return;
    try {
      await kill.mutateAsync(toKill);
      toast.success(t("kill.done"));
    } catch (error) {
      toast.error(t("kill.failed", { message: errorMessage(error) }));
    }
    setToKill(null);
    void queryClient.invalidateQueries({ queryKey: ["current-ops", connection.id] });
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b px-4">
        <h1 className="font-semibold text-base">{t("title")}</h1>
        <span className="truncate text-muted-foreground text-sm">
          {profileName}
          {current && ` · ${current.host} · ${current.process} ${current.version}`}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Select value={String(interval)} onValueChange={(value) => setIntervalMs(Number(value))}>
            <SelectTrigger size="sm" className="w-28" aria-label={t("interval")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {INTERVALS.map((value) => (
                <SelectItem key={value} value={String(value)}>
                  {t("every", { seconds: value / 1000 })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => setPaused(!paused)}>
            {paused ? <Play /> : <Pause />}
            {paused ? t("resume") : t("pause")}
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {status.error ? (
          <p role="alert" className="flex items-start gap-2 text-destructive text-sm selectable">
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            {t("statusFailed", { message: errorMessage(status.error) })}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <Stat
              label={t("stats.operations")}
              value={currentRates ? `${number(currentRates.totalOps)}/s` : "—"}
            >
              <Sparkline values={opsSeries} label={t("stats.operations")} />
              {currentRates && (
                <p className="text-muted-foreground text-[11px] tabular-nums">
                  {(["query", "insert", "update", "delete", "getmore", "command"] as const)
                    .map((kind) => `${t(`ops.${kind}`)} ${number(currentRates.ops[kind])}`)
                    .join(" · ")}
                </p>
              )}
            </Stat>
            <Stat
              label={t("stats.connections")}
              value={current ? number(current.connectionsCurrent ?? 0) : "—"}
            >
              {current && (
                <p className="text-muted-foreground text-xs">
                  {t("stats.available", { count: current.connectionsAvailable ?? 0 })}
                </p>
              )}
            </Stat>
            <Stat
              label={t("stats.network")}
              value={
                currentRates
                  ? `${formatBytes(currentRates.bytesInPerSecond + currentRates.bytesOutPerSecond)}/s`
                  : "—"
              }
            >
              <Sparkline values={netSeries} label={t("stats.network")} />
              {currentRates && (
                <p className="text-muted-foreground text-[11px] tabular-nums">
                  {t("stats.inOut", {
                    in: formatBytes(currentRates.bytesInPerSecond),
                    out: formatBytes(currentRates.bytesOutPerSecond),
                  })}
                </p>
              )}
            </Stat>
            <Stat
              label={t("stats.memory")}
              value={current ? formatBytes((current.residentMb ?? 0) * 1024 * 1024) : "—"}
            >
              {current && (
                <p className="text-muted-foreground text-xs">
                  {t("stats.uptime", { duration: uptime(current.uptimeSeconds ?? 0) })}
                </p>
              )}
            </Stat>
          </div>
        )}

        <section className="mt-6 flex flex-col gap-2" aria-label={t("ops.title")}>
          <div className="flex items-baseline gap-2">
            <h2 className="font-semibold text-sm">{t("ops.title")}</h2>
            <span className="text-muted-foreground text-xs">
              {ops.data ? t("ops.count", { count: ops.data.length }) : ""}
            </span>
          </div>
          {ops.error ? (
            <p role="alert" className="text-destructive text-xs selectable">
              {errorMessage(ops.error)}
            </p>
          ) : ops.data?.length === 0 ? (
            <p className="rounded-lg border p-6 text-center text-muted-foreground text-sm">
              {t("ops.none")}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 text-left text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">{t("ops.op")}</th>
                    <th className="px-3 py-2 font-medium">{t("ops.namespace")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("ops.running")}</th>
                    <th className="px-3 py-2 font-medium">{t("ops.client")}</th>
                    <th className="px-3 py-2 font-medium">{t("ops.commandColumn")}</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {ops.data?.map((op) => {
                    const command = op.command ? compactEJson(op.command).text : "";
                    return (
                      <tr key={JSON.stringify(op.opid)} className="border-t align-top">
                        <td className="px-3 py-2 font-medium">
                          {op.op}
                          {op.waitingForLock && (
                            <span className="ml-1.5 text-warning">{t("ops.waiting")}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 font-mono">{op.ns || "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {number(op.secsRunning ?? 0)} s
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {[op.appName, op.client].filter(Boolean).join(" · ") || op.description}
                        </td>
                        <td
                          className="max-w-md truncate px-3 py-2 font-mono text-muted-foreground"
                          title={command}
                        >
                          {command}
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-destructive hover:text-destructive"
                            disabled={connection.readOnly}
                            title={connection.readOnly ? t("kill.readOnly") : undefined}
                            onClick={() => setToKill(op)}
                          >
                            <OctagonX />
                            {t("kill.button")}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <AlertDialog open={toKill !== null} onOpenChange={(open) => !open && setToKill(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("kill.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("kill.description", { op: toKill?.op ?? "", ns: toKill?.ns || "—" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("actions.cancel", { ns: "common" })}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => void confirmKill()}
            >
              {t("kill.button")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Stat({ label, value, children }: { label: string; value: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border bg-card p-3">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="font-semibold text-xl tabular-nums">{value}</span>
      {children}
    </div>
  );
}

function uptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}
