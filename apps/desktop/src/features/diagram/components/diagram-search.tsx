import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconAction } from "@/components/icon-action";

interface DiagramSearchProps {
  query: string;
  onQueryChange: (query: string) => void;
  /** Collections matching the query, and which of them is focused. */
  matches: number;
  current: number;
  onStep: (direction: 1 | -1) => void;
}

/** Finds collections in the diagram: matches stand out as you type, Enter moves to the next. */
export function DiagramSearch({
  query,
  onQueryChange,
  matches,
  current,
  onStep,
}: DiagramSearchProps) {
  const { t } = useTranslation("diagram");
  const searching = query.trim() !== "";
  return (
    <div className="flex h-8 w-72 items-center gap-1 rounded-md border bg-card pr-1 pl-2.5 shadow-xs focus-within:ring-2 focus-within:ring-ring">
      <Search className="size-3.5 shrink-0 text-muted-foreground" />
      <input
        type="text"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onStep(event.shiftKey ? -1 : 1);
          } else if (event.key === "Escape") {
            onQueryChange("");
          }
        }}
        placeholder={t("search")}
        aria-label={t("search")}
        spellCheck={false}
        className="h-full min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
      />
      {searching && (
        <>
          <span className="shrink-0 text-muted-foreground text-xs tabular-nums" aria-live="polite">
            {matches === 0 ? t("noMatch") : t("matchOf", { current: current + 1, total: matches })}
          </span>
          <IconAction
            label={t("previousMatch")}
            disabled={matches === 0}
            onClick={() => onStep(-1)}
          >
            <ChevronUp />
          </IconAction>
          <IconAction label={t("nextMatch")} disabled={matches === 0} onClick={() => onStep(1)}>
            <ChevronDown />
          </IconAction>
          <IconAction label={t("clearSearch")} onClick={() => onQueryChange("")}>
            <X />
          </IconAction>
        </>
      )}
    </div>
  );
}
