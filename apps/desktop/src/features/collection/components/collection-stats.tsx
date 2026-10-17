import type { ConnectionId, Namespace } from "@odin-db/bindings";
import { Tooltip, TooltipContent, TooltipTrigger } from "@odin-db/ui/components/tooltip";
import { useTranslation } from "react-i18next";
import { formatBytes, formatCount } from "@/lib/format";
import { useCollectionStats } from "../api/use-collection-stats";

/** Document count and sizes, at a glance in the collection header. */
export function CollectionStats({
  connectionId,
  namespace,
}: {
  connectionId: ConnectionId;
  namespace: Namespace;
}) {
  const { t, i18n } = useTranslation("collection");
  const { data } = useCollectionStats(connectionId, namespace, true);
  if (!data) return null;

  const locale = i18n.language;
  // Sizes are f64 over IPC, which the bindings type as nullable.
  const value = (n: number | null) => n ?? 0;
  const rows = [
    [t("stats.documents"), formatCount(value(data.documents), locale)],
    [t("stats.size"), formatBytes(value(data.size), locale)],
    [t("stats.averageSize"), formatBytes(Math.round(value(data.averageDocumentSize)), locale)],
    [t("stats.storageSize"), formatBytes(value(data.storageSize), locale)],
    [t("stats.indexes"), formatCount(value(data.indexes), locale)],
    [t("stats.indexSize"), formatBytes(value(data.indexSize), locale)],
  ] as const;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <p className="hidden shrink-0 cursor-default text-muted-foreground text-xs tabular-nums lg:block">
          {t("stats.summary", {
            documents: formatCount(value(data.documents), locale),
            size: formatBytes(value(data.size), locale),
          })}
        </p>
      </TooltipTrigger>
      <TooltipContent className="p-3">
        <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1 text-xs">
          {rows.map(([label, text]) => (
            <div key={label} className="contents">
              <dt className="opacity-70">{label}</dt>
              <dd className="text-right tabular-nums">{text}</dd>
            </div>
          ))}
        </dl>
      </TooltipContent>
    </Tooltip>
  );
}
