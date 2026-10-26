import { Input } from "@odin-db/ui/components/input";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import type { KeyboardEvent, RefObject } from "react";
import { useTranslation } from "react-i18next";
import { IconAction } from "@/components/icon-action";
import { MAX_MATCHES } from "../lib/find";

/** Find in results, like a browser's Find in Page: Enter for the next match, Escape to close. */
export function FindBar({
  inputRef,
  query,
  onQuery,
  count,
  current,
  onStep,
  onClose,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  query: string;
  onQuery: (query: string) => void;
  count: number;
  /** The current match, from 0; -1 when there is none. */
  current: number;
  onStep: (step: 1 | -1) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation("results");

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      onStep(event.shiftKey ? -1 : 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  }

  return (
    <search className="flex h-9 shrink-0 items-center gap-1.5 border-b bg-sidebar px-2">
      <Search className="size-3.5 shrink-0 text-muted-foreground" />
      <Input
        ref={inputRef}
        type="search"
        autoFocus
        aria-label={t("find.label")}
        placeholder={t("find.placeholder")}
        value={query}
        onChange={(event) => onQuery(event.target.value)}
        onKeyDown={onKeyDown}
        className="h-7 max-w-80 [&::-webkit-search-cancel-button]:hidden"
      />
      <span role="status" className="min-w-20 text-muted-foreground text-xs tabular-nums">
        {query.trim() === ""
          ? null
          : count === 0
            ? t("find.none")
            : t(count >= MAX_MATCHES ? "find.countCapped" : "find.count", {
                current: current + 1,
                count,
              })}
      </span>
      <IconAction label={t("find.previous")} disabled={count === 0} onClick={() => onStep(-1)}>
        <ChevronUp />
      </IconAction>
      <IconAction label={t("find.next")} disabled={count === 0} onClick={() => onStep(1)}>
        <ChevronDown />
      </IconAction>
      <IconAction label={t("find.close")} onClick={onClose} className="ml-auto">
        <X />
      </IconAction>
    </search>
  );
}
