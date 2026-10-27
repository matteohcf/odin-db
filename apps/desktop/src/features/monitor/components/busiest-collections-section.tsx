import { type CollectionActivity, type ConnectionInfo, commands } from "@odin-db/bindings";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@odin-db/ui/components/table";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { call, errorMessage } from "@/lib/ipc";
import { type ActivityRate, activityRates } from "../lib/activity";
import { pollUntilError } from "../lib/polling";
import { MonitorSection } from "./monitor-section";
import { PollError } from "./poll-error";
import { SectionNote } from "./section-note";

interface BusiestCollectionsSectionProps {
  connection: ConnectionInfo;
  polling: number | false;
}

/** The collections taking the most server time right now, like Compass's hottest collections. */
export function BusiestCollectionsSection({ connection, polling }: BusiestCollectionsSectionProps) {
  const { t, i18n } = useTranslation("monitor");
  const activity = useQuery({
    queryKey: ["collection-activity", connection.id],
    queryFn: () => call(commands.collectionActivity(connection.id)),
    refetchInterval: pollUntilError(polling),
    retry: 1,
  });
  const previous = useRef<{ at: number; sample: readonly CollectionActivity[] } | null>(null);
  const [rates, setRates] = useState<ActivityRate[] | null>(null);
  useEffect(() => {
    const sample = activity.data;
    if (!sample) return;
    const now = activity.dataUpdatedAt;
    const last = previous.current;
    if (last && last.at !== now)
      setRates(activityRates(last.sample, sample, (now - last.at) / 1000));
    if (!last || last.at !== now) previous.current = { at: now, sample };
  }, [activity.data, activity.dataUpdatedAt]);

  // Not on a mongos, which has no per-collection counters.
  if (activity.data === null) return null;
  const number = (value: number) =>
    value.toLocaleString(i18n.language, { maximumFractionDigits: value < 10 ? 1 : 0 });
  const busiest = rates?.[0]?.busyMs ?? 0;

  return (
    <MonitorSection
      title={t("busiest.title")}
      detail={<span className="text-muted-foreground text-xs">{t("busiest.hint")}</span>}
    >
      {activity.error ? (
        <PollError onRetry={() => void activity.refetch()}>
          {t("busiest.failed", { message: errorMessage(activity.error) })}
        </PollError>
      ) : rates === null ? (
        <SectionNote>{t("stats.measuring")}</SectionNote>
      ) : rates.length === 0 ? (
        <SectionNote>{t("busiest.idle")}</SectionNote>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table className="min-w-2xl table-fixed">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>{t("busiest.collection")}</TableHead>
                <TableHead className="w-64">{t("busiest.time")}</TableHead>
                <TableHead className="w-28 text-right">{t("busiest.reads")}</TableHead>
                <TableHead className="w-28 text-right">{t("busiest.writes")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rates.map((rate) => (
                <TableRow key={rate.namespace}>
                  <TableCell className="truncate px-3 py-2 font-mono" title={rate.namespace}>
                    {rate.namespace}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${busiest ? (rate.busyMs / busiest) * 100 : 0}%` }}
                        />
                      </div>
                      <span className="w-20 text-right tabular-nums">
                        {t("busiest.msPerSecond", { value: number(rate.busyMs) })}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {number(rate.readsPerSecond)}/s
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {number(rate.writesPerSecond)}/s
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </MonitorSection>
  );
}
