import type { ModelEntry } from "@odin-db/bindings";
import { Badge } from "@odin-db/ui/components/badge";
import { Progress } from "@odin-db/ui/components/progress";
import { useTranslation } from "react-i18next";
import { useModelDownloads } from "@/features/ai";
import { formatBytes } from "@/lib/format";
import { AccuracyMeter } from "./accuracy-meter";
import { AiModelActions } from "./ai-model-actions";

interface AiModelRowProps {
  entry: ModelEntry;
  recommended: boolean;
  /** This machine's memory, to flag models that need more. */
  memoryGib: number;
}

/** One catalog model in the models table. */
export function AiModelRow({ entry, recommended, memoryGib }: AiModelRowProps) {
  const { t, i18n } = useTranslation("settings");
  const { spec, state } = entry;
  const download = useModelDownloads((s) => s.downloads[spec.id]);
  const size = (bytes: number) => formatBytes(bytes, i18n.language);
  // f64 crosses IPC as nullable (NaN has no JSON form).
  const total = spec.size ?? 0;
  const received =
    download?.progress?.received ?? (state.state === "partial" ? state.received : 0) ?? 0;
  const seconds = spec.benchmark?.secondsPerQuery;
  const speed = seconds
    ? t("ai.table.seconds", { seconds: seconds.toLocaleString(i18n.language) })
    : "—";
  const needsMore = memoryGib > 0 && memoryGib < spec.minMemoryGib;

  return (
    <tr data-setting-row className="align-top">
      <td className="py-3 pr-4 pl-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium text-sm">{spec.name}</span>
          <Badge variant="outline">{t(`ai.tiers.${spec.tier}`)}</Badge>
          {recommended && <Badge>{t("ai.recommended")}</Badge>}
        </div>
        {/* Narrow sections drop the numeric columns; their values move under the name. */}
        <div className="flex flex-wrap items-center gap-x-3 pt-1.5 text-xs @2xl:hidden">
          <AccuracyMeter accuracy={spec.benchmark?.accuracy} />
          <span className="text-muted-foreground tabular-nums">
            {speed} · {size(total)}
          </span>
        </div>
        {download ? (
          <div className="flex flex-col gap-1.5 pt-2">
            <Progress
              value={total > 0 ? (received / total) * 100 : null}
              aria-label={t("ai.downloading", { name: spec.name })}
              className="h-1.5 w-full max-w-56"
            />
            <span className="text-muted-foreground text-xs tabular-nums">
              {t("ai.progress", { received: size(received), total: size(total) })}
            </span>
          </div>
        ) : (
          <p className="pt-1 text-muted-foreground text-xs">
            {t(`ai.notes.${spec.id}`, { defaultValue: "" })}
            <span className="block pt-0.5">
              {spec.publisher} · {spec.license}
              {needsMore && (
                <span className="text-amber-600 dark:text-amber-500">
                  {" · "}
                  {t("ai.table.needsMemory", { memory: spec.minMemoryGib })}
                </span>
              )}
            </span>
          </p>
        )}
      </td>
      <td className="hidden py-3 pr-4 text-xs @2xl:table-cell">
        <AccuracyMeter accuracy={spec.benchmark?.accuracy} />
      </td>
      <td className="hidden whitespace-nowrap py-3 pr-4 text-xs tabular-nums @2xl:table-cell">
        {speed}
      </td>
      <td className="hidden whitespace-nowrap py-3 pr-4 text-xs tabular-nums @2xl:table-cell">
        {size(total)}
      </td>
      <td className="py-2.5 pr-4">
        <AiModelActions entry={entry} />
      </td>
    </tr>
  );
}
