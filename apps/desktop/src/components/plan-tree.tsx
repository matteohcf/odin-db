import type { PlanStep } from "@odin-db/bindings";
import { cn } from "@odin-db/ui/lib/utils";
import { useTranslation } from "react-i18next";
import { compactEJson } from "@/lib/ejson-display";
import { formatCount } from "@/lib/format";

interface PlanTreeProps {
  steps: readonly PlanStep[];
  plansConsidered: number;
}

/** The winning plan's stages, root first and inputs indented, with what each one did. */
export function PlanTree({ steps, plansConsidered }: PlanTreeProps) {
  const { t, i18n } = useTranslation("common");
  const count = (value: number) => formatCount(value, i18n.language);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-2">
        <p className="text-muted-foreground text-xs">{t("explain.stages")}</p>
        <p className="text-muted-foreground text-[11px]">
          {t("explain.stagesHint")}
          {plansConsidered > 1 && ` · ${t("explain.plansConsidered", { count: plansConsidered })}`}
        </p>
      </div>
      <ol className="flex flex-col overflow-hidden rounded-md border">
        {steps.map((step, index) => {
          const examined =
            step.keysExamined != null
              ? t("explain.stepKeys", { count: step.keysExamined, value: count(step.keysExamined) })
              : step.documentsExamined != null
                ? t("explain.stepDocuments", {
                    count: step.documentsExamined,
                    value: count(step.documentsExamined),
                  })
                : null;
          return (
            // Steps are positional; the same stage can appear twice.
            <li
              key={index}
              className="flex items-center gap-3 border-t px-3 py-1.5 text-xs first:border-t-0"
              style={{ paddingLeft: `${0.75 + step.depth * 1.25}rem` }}
            >
              {step.depth > 0 && (
                <span aria-hidden className="-ml-2 text-muted-foreground/60">
                  └
                </span>
              )}
              <span
                className={cn(
                  "rounded-sm border px-1.5 py-0.5 font-mono text-[11px]",
                  step.stage === "COLLSCAN"
                    ? "border-warning/40 text-warning"
                    : step.stage === "IXSCAN"
                      ? "border-primary/40 text-primary"
                      : "border-transparent bg-muted",
                )}
              >
                {step.stage}
              </span>
              {step.indexName && (
                <span
                  className="min-w-0 truncate font-mono text-muted-foreground selectable"
                  title={indexLabel(step)}
                >
                  {indexLabel(step)}
                </span>
              )}
              <span className="ml-auto flex shrink-0 gap-3 text-muted-foreground tabular-nums">
                {examined && <span>{examined}</span>}
                {step.returned != null && (
                  <span className="text-foreground">
                    {t("explain.stepReturned", {
                      count: step.returned,
                      value: count(step.returned),
                    })}
                  </span>
                )}
                {step.milliseconds != null && (
                  <span>{t("explain.milliseconds", { value: count(step.milliseconds) })}</span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

const indexLabel = (step: PlanStep) =>
  [step.indexName, step.keyPattern && compactEJson(step.keyPattern).text].filter(Boolean).join(" ");
