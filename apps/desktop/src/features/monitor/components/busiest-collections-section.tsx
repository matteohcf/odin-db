import { type CollectionActivity, type ConnectionInfo, commands } from "@odin-db/bindings";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { call, errorMessage } from "@/lib/ipc";
import { type ActivityRate, activityRates } from "../lib/activity";

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
    refetchInterval: polling,
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
    <section className="mt-6 flex flex-col gap-2" aria-label={t("busiest.title")}>
      <div className="flex items-baseline gap-2">
        <h2 className="font-semibold text-sm">{t("busiest.title")}</h2>
        <span className="text-muted-foreground text-xs">{t("busiest.hint")}</span>
      </div>
      {activity.error ? (
        <p role="alert" className="text-destructive text-xs selectable">
          {t("busiest.failed", { message: errorMessage(activity.error) })}
        </p>
      ) : rates === null ? (
        <p className="rounded-lg border p-6 text-center text-muted-foreground text-sm">
          {t("stats.measuring")}
        </p>
      ) : rates.length === 0 ? (
        <p className="rounded-lg border p-6 text-center text-muted-foreground text-sm">
          {t("busiest.idle")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-2xl table-fixed text-xs">
            <thead className="bg-muted/40 text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">{t("busiest.collection")}</th>
                <th className="w-64 px-3 py-2 font-medium">{t("busiest.time")}</th>
                <th className="w-28 px-3 py-2 text-right font-medium">{t("busiest.reads")}</th>
                <th className="w-28 px-3 py-2 text-right font-medium">{t("busiest.writes")}</th>
              </tr>
            </thead>
            <tbody>
              {rates.map((rate) => (
                <tr key={rate.namespace} className="border-t">
                  <td className="truncate px-3 py-2 font-mono" title={rate.namespace}>
                    {rate.namespace}
                  </td>
                  <td className="px-3 py-2">
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
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {number(rate.readsPerSecond)}/s
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {number(rate.writesPerSecond)}/s
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
