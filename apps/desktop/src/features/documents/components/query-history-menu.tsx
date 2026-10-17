import { Button } from "@odin-db/ui/components/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@odin-db/ui/components/command";
import { Popover, PopoverContent, PopoverTrigger } from "@odin-db/ui/components/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@odin-db/ui/components/tooltip";
import { cn } from "@odin-db/ui/lib/utils";
import { History, Star } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { formatRelativeTime } from "@/lib/format";
import type { QueryForm } from "../lib/query-form";
import { sameForm, useQueryHistory } from "../store/query-history-store";

const OPTION_FIELDS = ["sort", "projection", "skip", "limit"] as const;
const NO_ENTRIES: never[] = [];

interface QueryHistoryMenuProps {
  historyKey: string;
  onSelect: (form: QueryForm) => void;
}

/** Saved and recent queries of the collection, searchable. */
export function QueryHistoryMenu({ historyKey, onSelect }: QueryHistoryMenuProps) {
  const { t } = useTranslation("documents");
  const [open, setOpen] = useState(false);
  const entries = useQueryHistory((state) => state.entries[historyKey] ?? NO_ENTRIES);
  const saved = useQueryHistory((state) => state.saved[historyKey] ?? NO_ENTRIES);
  const clear = useQueryHistory((state) => state.clear);
  const toggleSaved = useQueryHistory((state) => state.toggleSaved);
  const isSaved = (form: QueryForm) => saved.some((entry) => sameForm(entry.form, form));
  const select = (form: QueryForm) => {
    onSelect(form);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* The span keeps the tooltip's data-state off the popover trigger. */}
          <span className="inline-flex">
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("history.open")}
                className="text-muted-foreground"
              >
                <History />
              </Button>
            </PopoverTrigger>
          </span>
        </TooltipTrigger>
        <TooltipContent>{t("history.open")}</TooltipContent>
      </Tooltip>
      <PopoverContent className="w-[34rem] p-0" align="end">
        <Command>
          <div className="flex items-center gap-2 border-b pr-2 *:data-[slot=command-input-wrapper]:flex-1 *:data-[slot=command-input-wrapper]:border-0">
            <CommandInput placeholder={t("history.search")} />
            {entries.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-muted-foreground text-xs"
                onClick={() => clear(historyKey)}
              >
                {t("history.clear")}
              </Button>
            )}
          </div>
          <CommandList className="max-h-96">
            <CommandEmpty>
              {entries.length + saved.length === 0 ? t("history.empty") : t("history.noMatch")}
            </CommandEmpty>
            {saved.length > 0 && (
              <CommandGroup heading={t("history.saved")}>
                {saved.map((entry) => (
                  <HistoryItem
                    key={`saved-${entry.ranAt}`}
                    value={`saved ${entry.ranAt}`}
                    form={entry.form}
                    time={null}
                    saved
                    onSelect={() => select(entry.form)}
                    onToggleSaved={() => toggleSaved(historyKey, entry.form)}
                  />
                ))}
              </CommandGroup>
            )}
            {entries.length > 0 && (
              <CommandGroup heading={t("history.recent")}>
                {entries.map((entry) => (
                  <HistoryItem
                    key={entry.ranAt}
                    value={`recent ${entry.ranAt}`}
                    form={entry.form}
                    time={entry.ranAt}
                    saved={isSaved(entry.form)}
                    onSelect={() => select(entry.form)}
                    onToggleSaved={() => toggleSaved(historyKey, entry.form)}
                  />
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function HistoryItem({
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
