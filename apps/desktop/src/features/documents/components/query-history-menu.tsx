import { Button } from "@odin-db/ui/components/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandList,
} from "@odin-db/ui/components/command";
import { Popover, PopoverContent, PopoverTrigger } from "@odin-db/ui/components/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@odin-db/ui/components/tooltip";
import { History } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { QueryForm } from "../lib/query-form";
import { sameForm, useQueryHistory } from "../store/query-history-store";
import { HistoryItem } from "./history-item";

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
