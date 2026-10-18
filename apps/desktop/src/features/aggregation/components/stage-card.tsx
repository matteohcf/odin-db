import type { ConnectionId, FieldSummary, Namespace } from "@odin-db/bindings";
import { Button } from "@odin-db/ui/components/button";
import { Switch } from "@odin-db/ui/components/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@odin-db/ui/components/tooltip";
import { cn } from "@odin-db/ui/lib/utils";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CodeEditor } from "@/components/code-editor";
import { useQueryCompletions } from "@/hooks/use-query-completions";
import { useStageInputFields } from "../api/use-stage-input-fields";
import { queryKindOf } from "../lib/operators";
import type { Stage } from "../lib/pipeline";
import { OperatorPicker } from "./operator-picker";
import { StagePreview } from "./stage-preview";

interface StageCardProps {
  connectionId: ConnectionId;
  namespace: Namespace;
  stages: readonly Stage[];
  index: number;
  /** `field` is a likely field of the stage's input, for the new template. */
  onOperatorChange: (operator: string, field?: string) => void;
  onBodyChange: (body: string) => void;
  onToggle: (enabled: boolean) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
  onAddAfter: () => void;
  onRun: () => void;
}

/** One pipeline stage: operator, body editor and a live preview of its output. */
export function StageCard({
  connectionId,
  namespace,
  stages,
  index,
  onOperatorChange,
  onBodyChange,
  onToggle,
  onMove,
  onRemove,
  onAddAfter,
  onRun,
}: StageCardProps) {
  const { t } = useTranslation("aggregation");
  const stage = stages[index];
  const fields = useStageInputFields(connectionId, namespace, stages, index);
  const completionsFor = useQueryCompletions(fields);
  if (!stage) return null;
  const number = index + 1;

  return (
    <section
      aria-label={t("stage.label", { number })}
      className={cn("rounded-lg border bg-card", !stage.enabled && "opacity-60")}
    >
      <header className="flex h-10 items-center gap-2 border-b px-2.5">
        {/* Stages are a sequence: the number is the order the server applies them in. */}
        <span className="flex size-5 items-center justify-center rounded-full bg-muted font-mono text-[11px] text-muted-foreground">
          {number}
        </span>
        <OperatorPicker
          value={stage.operator}
          onChange={(operator) => onOperatorChange(operator, templateField(fields))}
        />
        <span className="truncate text-muted-foreground text-xs">
          {t(`operators.${stage.operator}` as "operators.$match", { defaultValue: "" })}
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          <IconAction label={t("stage.enabled")}>
            {/* A wrapper keeps the tooltip's data-state from overriding the switch's own. */}
            <span className="mx-1.5 inline-flex">
              <Switch
                checked={stage.enabled}
                onCheckedChange={onToggle}
                aria-label={t("stage.enabled")}
              />
            </span>
          </IconAction>
          <IconAction label={t("stage.moveUp")}>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              disabled={index === 0}
              onClick={() => onMove(-1)}
              aria-label={t("stage.moveUp")}
            >
              <ArrowUp />
            </Button>
          </IconAction>
          <IconAction label={t("stage.moveDown")}>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              disabled={index === stages.length - 1}
              onClick={() => onMove(1)}
              aria-label={t("stage.moveDown")}
            >
              <ArrowDown />
            </Button>
          </IconAction>
          <IconAction label={t("stage.addAfter")}>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={onAddAfter}
              aria-label={t("stage.addAfter")}
            >
              <Plus />
            </Button>
          </IconAction>
          <IconAction label={t("stage.remove")}>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 hover:text-destructive"
              onClick={onRemove}
              aria-label={t("stage.remove")}
            >
              <Trash2 />
            </Button>
          </IconAction>
        </div>
      </header>
      <div className="grid grid-cols-2 divide-x">
        <CodeEditor
          // Remount when the operator swaps in a new template.
          key={`${stage.id}:${stage.operator}`}
          initialValue={stage.body}
          onChange={onBodyChange}
          onSubmit={onRun}
          ariaLabel={t("stage.editor", { number })}
          completions={completionsFor(queryKindOf(stage.operator))}
          className="h-44 rounded-bl-lg"
        />
        <StagePreview
          connectionId={connectionId}
          namespace={namespace}
          stages={stages}
          index={index}
        />
      </div>
    </section>
  );
}

function IconAction({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** A field worth starting a stage with: a string (good to group or match on), else any. */
function templateField(fields: readonly FieldSummary[]): string | undefined {
  const candidates = fields.filter((field) => field.path !== "_id" && !field.path.includes("."));
  return (candidates.find((field) => field.types[0] === "string") ?? candidates[0])?.path;
}
