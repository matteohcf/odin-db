import { CommandItem } from "@odin-db/ui/components/command";
import { cn } from "@odin-db/ui/lib/utils";
import { Star } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatRelativeTime } from "@/lib/format";
import type { QueryForm } from "../lib/query-form";

const OPTION_FIELDS = ["sort", "projection", "skip", "limit"] as const;

/** One saved or recent query in the history menu. */
export function HistoryItem({
  value,
  form,
  time,
  saved,
  onSelect,
  onToggleSaved,
}: {
  value: string;
  form: QueryForm;
  /** When it last ran; `null` for saved queries. */
  time: number | null;
  saved: boolean;
  onSelect: () => void;
  onToggleSaved: () => void;
}) {
  const { t, i18n } = useTranslation("documents");
  const options = OPTION_FIELDS.filter((field) => form[field].trim() !== "");
  const label = saved ? t("history.unsave") : t("history.save");

  return (
    <CommandItem
      // The text makes the entry searchable; the prefix keeps values unique.
      value={`${value} ${Object.values(form).join(" ")}`}
      onSelect={onSelect}
      className="group/item flex-col items-stretch gap-1 py-2"
    >
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1 truncate font-mono text-xs">
          {form.filter.trim() || (
            <span className="text-muted-foreground">{t("history.matchAll")}</span>
          )}
        </span>
        {time !== null && (
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {formatRelativeTime(time, Date.now(), i18n.language)}
          </span>
        )}
        <button
          type="button"
          aria-label={label}
          title={label}
          aria-pressed={saved}
          // The row selects on click; the star must not run the query.
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onToggleSaved();
          }}
          className={cn(
            "shrink-0 rounded-sm p-0.5 text-muted-foreground hover:text-foreground",
            saved
              ? "text-warning hover:text-warning"
              : "opacity-0 group-hover/item:opacity-100 group-data-[selected=true]/item:opacity-100",
          )}
        >
          <Star className={cn("size-3.5 text-current", saved && "fill-current")} />
        </button>
      </div>
      {options.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
          {options.map((field) => (
            <span key={field} className="min-w-0 truncate">
              <span className="text-muted-foreground">{t(`query.${field}`)}</span>{" "}
              <span className="font-mono">{form[field].trim()}</span>
            </span>
          ))}
        </div>
      )}
    </CommandItem>
  );
}
