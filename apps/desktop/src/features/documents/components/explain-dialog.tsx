import type { QueryPlan } from "@odin-db/bindings";
import { Button } from "@odin-db/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@odin-db/ui/components/dialog";
import { cn } from "@odin-db/ui/lib/utils";
import { ChevronRight, CircleCheck, ListPlus, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CodeEditor } from "@/components/code-editor";
import { formatCount } from "@/lib/format";
import { toShellSyntax } from "@/lib/shell-syntax";

interface ExplainDialogProps {
  collection: string;
  plan: QueryPlan;
  /** Index keys that would serve the query, if any. */
  suggestedIndex: string | null;
  /** Omitted when the user cannot create indexes. */
  onCreateIndex?: ((keys: string) => void) | undefined;
  onClose: () => void;
}

/** The winning plan in a sentence, its key counts, its stages, and the raw output. */
export function ExplainDialog({
  collection,
  plan,
  suggestedIndex,
  onCreateIndex,
  onClose,
}: ExplainDialogProps) {
  const { t, i18n } = useTranslation("documents");
  const [showRaw, setShowRaw] = useState(false);
  // Counts are f64 over IPC, which the bindings type as nullable.
  const count = (value: number | null) => formatCount(value ?? 0, i18n.language);
  const returned = plan.returned ?? 0;
  const documentsExamined = plan.documentsExamined ?? 0;
  // A scan that reads many more documents than it returns is the case worth flagging.
  const wasteful = plan.collectionScan && documentsExamined > Math.max(returned * 2, 100);

  const verdict = plan.collectionScan
    ? t("explain.collectionScan")
    : plan.indexes.length > 0
      ? t("explain.usedIndex", { count: plan.indexes.length, indexes: plan.indexes.join(", ") })
      : t("explain.noIndex");

  const stats = [
    { label: t("explain.returned"), value: count(plan.returned) },
    { label: t("explain.documentsExamined"), value: count(plan.documentsExamined) },
    { label: t("explain.keysExamined"), value: count(plan.keysExamined) },
    {
      label: t("explain.time"),
      value: t("explain.milliseconds", { value: count(plan.milliseconds) }),
    },
  ];

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("explain.title")}</DialogTitle>
          <DialogDescription>{t("explain.description", { collection })}</DialogDescription>
        </DialogHeader>

        <div
          className={cn(
            "flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-sm",
            wasteful ? "border-warning/40 bg-warning/5" : "border-success/30 bg-success/5",
          )}
        >
          {wasteful ? (
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
          ) : (
            <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" />
          )}
          <div className="flex flex-col gap-0.5">
            <p className="font-medium selectable">{verdict}</p>
            {wasteful && (
              <p className="text-muted-foreground text-xs">{t("explain.collectionScanHint")}</p>
            )}
            {wasteful && suggestedIndex && onCreateIndex && (
              <Button
                size="sm"
                variant="outline"
                className="mt-1.5 self-start"
                onClick={() => onCreateIndex(suggestedIndex)}
              >
                <ListPlus />
                {t("explain.createIndex")}
                <span className="font-mono text-muted-foreground text-xs">{suggestedIndex}</span>
              </Button>
            )}
          </div>
        </div>

        <dl className="grid grid-cols-4 gap-2">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="flex flex-col gap-0.5 rounded-md bg-muted/50 px-3 py-2"
            >
              <dt className="text-muted-foreground text-[11px]">{stat.label}</dt>
              <dd className="font-mono text-sm tabular-nums">{stat.value}</dd>
            </div>
          ))}
        </dl>

        {plan.stages.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <p className="text-muted-foreground text-xs">{t("explain.stages")}</p>
            <ol className="flex flex-wrap items-center gap-1">
              {plan.stages.map((stage, index) => (
                // Stages are positional; the same name can appear twice.
                <li key={`${index}-${stage}`} className="flex items-center gap-1">
                  {index > 0 && <ChevronRight className="size-3 text-muted-foreground" />}
                  <span
                    className={cn(
                      "rounded-sm px-1.5 py-0.5 font-mono text-[11px]",
                      stage === "COLLSCAN" ? "bg-warning/15 text-warning" : "bg-muted",
                    )}
                  >
                    {stage}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <button
            type="button"
            aria-expanded={showRaw}
            onClick={() => setShowRaw((value) => !value)}
            className="flex items-center gap-1 self-start text-muted-foreground text-xs hover:text-foreground"
          >
            <ChevronRight className={cn("size-3.5 transition-transform", showRaw && "rotate-90")} />
            {t("explain.raw")}
          </button>
          {showRaw && (
            <CodeEditor
              initialValue={toShellSyntax(plan.raw)}
              readOnly
              ariaLabel={t("explain.raw")}
              className="h-72 rounded-md border"
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
