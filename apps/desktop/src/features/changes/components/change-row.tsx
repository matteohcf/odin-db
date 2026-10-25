import type { ChangeEvent } from "@odin-db/bindings";
import { cn } from "@odin-db/ui/lib/utils";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toShellSyntax } from "@/lib/shell-syntax";
import { idOf, summarize } from "../lib/change-summary";
import { operationClass } from "../lib/operation-colors";

/** One change in the live feed; opens to the full document and what an update set. */
export function ChangeRow({ change }: { change: ChangeEvent }) {
  const { t, i18n } = useTranslation("changes");
  const [open, setOpen] = useState(false);
  const time =
    change.at === null
      ? ""
      : new Intl.DateTimeFormat(i18n.language, {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          fractionalSecondDigits: 3,
          hourCycle: "h23",
        }).format(change.at);
  const details = change.operation === "update" ? change.updated : change.document;
  return (
    <li className="border-b last:border-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        disabled={!details}
        className="flex w-full items-center gap-3 px-3 py-1.5 text-left text-xs enabled:hover:bg-accent"
      >
        <ChevronRight
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90",
            !details && "invisible",
          )}
        />
        <span className="w-24 shrink-0 whitespace-nowrap font-mono text-muted-foreground tabular-nums">
          {time}
        </span>
        <span
          className={cn(
            "w-16 shrink-0 rounded-sm border px-1.5 py-0.5 text-center font-medium text-[11px]",
            operationClass[change.operation] ?? "border-border text-muted-foreground",
          )}
        >
          {t(`operations.${change.operation}`, { defaultValue: change.operation })}
        </span>
        <span className="w-56 shrink-0 truncate font-mono text-type-object-id">{idOf(change)}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">
          {summarize(change)}
        </span>
      </button>
      {open && details && (
        <pre className="max-h-72 overflow-auto border-t bg-muted/30 px-10 py-2 font-mono text-[11px] selectable">
          {toShellSyntax(details)}
          {change.removed.length > 0 && `\n\n${t("removed")}: ${change.removed.join(", ")}`}
        </pre>
      )}
    </li>
  );
}
