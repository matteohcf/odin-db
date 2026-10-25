import { cn } from "@odin-db/ui/lib/utils";
import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { OPERATIONS, type Operation } from "../lib/change-summary";
import { operationClass } from "../lib/operation-colors";

/** Which operations the feed shows: a chip each, checked when shown, with its count. */
export function OperationFilter({
  shown,
  counts,
  onChange,
}: {
  shown: readonly Operation[];
  counts: Record<Operation, number>;
  onChange: (shown: Operation[]) => void;
}) {
  const { t } = useTranslation("changes");
  return (
    <fieldset
      aria-label={t("filter")}
      className="m-0 flex min-w-0 items-center gap-1.5 border-0 p-0"
    >
      <span className="text-muted-foreground text-xs">{t("show")}</span>
      {OPERATIONS.map((operation) => {
        const on = shown.includes(operation);
        return (
          <button
            key={operation}
            type="button"
            aria-pressed={on}
            onClick={() =>
              onChange(on ? shown.filter((o) => o !== operation) : [...shown, operation])
            }
            className={cn(
              "flex h-7 items-center gap-1 rounded-md border px-2 font-medium text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
              on
                ? cn(operationClass[operation], "hover:bg-accent/60")
                : "border-dashed text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            )}
          >
            <Check className={cn("size-3", !on && "invisible")} aria-hidden />
            {t(`operations.${operation}`)}
            <span className="font-normal tabular-nums opacity-80">{counts[operation]}</span>
          </button>
        );
      })}
    </fieldset>
  );
}
