import { Button } from "@odin-db/ui/components/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@odin-db/ui/components/command";
import { Popover, PopoverContent, PopoverTrigger } from "@odin-db/ui/components/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@odin-db/ui/components/tooltip";
import { History } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { formatRelativeTime } from "@/lib/format";
import type { QueryForm } from "../lib/query-form";
import { useQueryHistory } from "../store/query-history-store";

const OPTION_FIELDS = ["sort", "projection", "skip", "limit"] as const;
const NO_ENTRIES: never[] = [];

interface QueryHistoryMenuProps {
  historyKey: string;
  onSelect: (form: QueryForm) => void;
}

/** Recent queries of the collection, searchable, newest first. */
export function QueryHistoryMenu({ historyKey, onSelect }: QueryHistoryMenuProps) {
  const { t, i18n } = useTranslation("documents");
  const [open, setOpen] = useState(false);
  const entries = useQueryHistory((state) => state.entries[historyKey] ?? NO_ENTRIES);
  const clear = useQueryHistory((state) => state.clear);
  const now = Date.now();

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
              {entries.length === 0 ? t("history.empty") : t("history.noMatch")}
            </CommandEmpty>
            {entries.map((entry) => {
              const options = OPTION_FIELDS.filter((field) => entry.form[field].trim() !== "");
              return (
                <CommandItem
                  key={entry.ranAt}
                  value={`${entry.ranAt} ${Object.values(entry.form).join(" ")}`}
                  onSelect={() => {
                    onSelect(entry.form);
                    setOpen(false);
                  }}
                  className="flex-col items-stretch gap-1 py-2"
                >
                  <div className="flex items-baseline gap-3">
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">
                      {entry.form.filter.trim() || (
                        <span className="text-muted-foreground">{t("history.matchAll")}</span>
                      )}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {formatRelativeTime(entry.ranAt, now, i18n.language)}
                    </span>
                  </div>
                  {options.length > 0 && (
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
                      {options.map((field) => (
                        <span key={field} className="min-w-0 truncate">
                          <span className="text-muted-foreground">{t(`query.${field}`)}</span>{" "}
                          <span className="font-mono">{entry.form[field].trim()}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </CommandItem>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
