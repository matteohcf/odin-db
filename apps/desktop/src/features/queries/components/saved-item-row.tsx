import type { ProfileColor } from "@odin-db/bindings";
import { Badge } from "@odin-db/ui/components/badge";
import { Button } from "@odin-db/ui/components/button";
import { Search, Trash2, Workflow } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconAction } from "@/components/icon-action";
import { ProfileColorMark } from "@/components/profile-color-mark";
import { formatRelativeTime } from "@/lib/format";
import type { SavedItem } from "../lib/saved-items";

interface SavedItemRowProps {
  item: SavedItem;
  profileName: string;
  color: ProfileColor | null;
  now: number;
  onOpen: () => void;
  onRemove: () => void;
}

/** One saved query or pipeline: where it runs, what it does, and when it was saved. */
export function SavedItemRow({
  item,
  profileName,
  color,
  now,
  onOpen,
  onRemove,
}: SavedItemRowProps) {
  const { t, i18n } = useTranslation("queries");
  const Icon = item.kind === "query" ? Search : Workflow;
  const title = item.kind === "query" ? item.form.filter.trim() || "{}" : item.name;
  const detail =
    item.kind === "query"
      ? [
          item.form.sort.trim() && `${t("sort")} ${item.form.sort.trim()}`,
          item.form.projection.trim() && `${t("projection")} ${item.form.projection.trim()}`,
          item.form.limit.trim() && `${t("limit")} ${item.form.limit.trim()}`,
        ]
          .filter(Boolean)
          .join(" · ")
      : item.pipeline.stages.map((stage) => stage.operator).join(" → ");
  return (
    <li className="group flex items-center gap-3 px-4 py-2.5 hover:bg-accent/50">
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={
            item.kind === "query" ? "truncate font-mono text-xs" : "truncate font-medium text-sm"
          }
        >
          {title}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs">
          <ProfileColorMark color={color} />
          <span className="truncate">
            {profileName} · {item.database}.{item.collection}
          </span>
          {detail && <span className="truncate font-mono">· {detail}</span>}
        </span>
      </div>
      <Badge variant="secondary" className="shrink-0">
        {item.kind === "query" ? t("kind.query") : t("kind.pipeline")}
      </Badge>
      <span className="w-24 shrink-0 text-right text-muted-foreground text-xs">
        {formatRelativeTime(item.savedAt, now, i18n.language)}
      </span>
      <span className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
        <IconAction label={t("remove")} onClick={onRemove} className="hover:text-destructive">
          <Trash2 />
        </IconAction>
      </span>
      <Button size="sm" variant="outline" onClick={onOpen}>
        {t("open")}
      </Button>
    </li>
  );
}
