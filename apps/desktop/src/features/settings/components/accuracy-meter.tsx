import { cn } from "@odin-db/ui/lib/utils";
import { useTranslation } from "react-i18next";

/** Eval accuracy as a short bar and a percentage; a dash when the model was not measured. */
export function AccuracyMeter({ accuracy }: { accuracy: number | null | undefined }) {
  const { t } = useTranslation("settings");
  if (accuracy === null || accuracy === undefined) {
    return (
      <span className="text-muted-foreground" title={t("ai.table.notMeasured")}>
        —
      </span>
    );
  }
  const percent = Math.round(accuracy * 100);
  return (
    <div className="flex items-center gap-2">
      {/* The percentage beside it is what assistive technology reads. */}
      <div aria-hidden className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full",
            percent >= 80 ? "bg-primary" : percent >= 65 ? "bg-primary/60" : "bg-primary/30",
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="tabular-nums">{percent}%</span>
    </div>
  );
}
