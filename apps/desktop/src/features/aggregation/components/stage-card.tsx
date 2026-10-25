import type { ConnectionId, FieldSummary, Namespace } from "@odin-db/bindings";
import { Button } from "@odin-db/ui/components/button";
import { Switch } from "@odin-db/ui/components/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@odin-db/ui/components/tooltip";
import { cn } from "@odin-db/ui/lib/utils";
import { ArrowDown, ArrowUp, ChevronRight, Maximize2, Minimize2, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CodeEditor } from "@/components/code-editor";
import { IconAction } from "@/components/icon-action";
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
  // Collapsed, a long pipeline reads as an outline; tall, a long stage has room.
  const [collapsed, setCollapsed] = useState(false);
  const [tall, setTall] = useState(false);
  if (!stage) return null;
  const number = index + 1;

  return (
    <section
      aria-label={t("stage.label", { number })}
      className={cn("rounded-lg border bg-card", !stage.enabled && "opacity-60")}
    >
      <header className={cn("flex h-10 items-center gap-2 px-2.5", !collapsed && "border-b")}>
        <Button
          variant="ghost"
          size="icon"
          className="-mr-1 size-6"
          aria-expanded={!collapsed}
          aria-label={t(collapsed ? "stage.expand" : "stage.collapse")}
          onClick={() => setCollapsed((value) => !value)}
        >
          <ChevronRight className={cn("transition-transform", !collapsed && "rotate-90")} />
        </Button>
        {/* Stages are a sequence: the number is the order the server applies them in. */}
        <span className="flex size-5 items-center justify-center rounded-full bg-muted font-mono text-[11px] text-muted-foreground">
          {number}
        </span>
        <OperatorPicker
          value={stage.operator}
          onChange={(operator) => onOperatorChange(operator, templateField(fields))}
        />
        {collapsed ? (
          <code className="min-w-0 truncate font-mono text-muted-foreground text-xs">
            {stage.body.replace(/\s+/g, " ").trim()}
          </code>
        ) : (
          <span className="truncate text-muted-foreground text-xs">
            {t(`operators.${stage.operator}` as "operators.$match", { defaultValue: "" })}
          </span>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              {/* A wrapper keeps the tooltip's data-state from overriding the switch's own. */}
              <span className="mx-1.5 inline-flex">
                <Switch
                  checked={stage.enabled}
                  onCheckedChange={onToggle}
                  aria-label={t("stage.enabled")}
                />
              </span>
            </TooltipTrigger>
            <TooltipContent>{t("stage.enabled")}</TooltipContent>
          </Tooltip>
          {!collapsed && (
            <IconAction
              label={t(tall ? "stage.shorter" : "stage.taller")}
              onClick={() => setTall((value) => !value)}
              className="size-7"
            >
              {tall ? <Minimize2 /> : <Maximize2 />}
            </IconAction>
          )}
          <IconAction
            label={t("stage.moveUp")}
            onClick={() => onMove(-1)}
            disabled={index === 0}
            className="size-7"
          >
            <ArrowUp />
          </IconAction>
          <IconAction
            label={t("stage.moveDown")}
            onClick={() => onMove(1)}
            disabled={index === stages.length - 1}
            className="size-7"
          >
            <ArrowDown />
          </IconAction>
          <IconAction label={t("stage.addAfter")} onClick={onAddAfter} className="size-7">
            <Plus />
          </IconAction>
          <IconAction
            label={t("stage.remove")}
            onClick={onRemove}
            className="size-7 hover:text-destructive"
          >
            <Trash2 />
          </IconAction>
        </div>
      </header>
      <div className={cn("grid grid-cols-2 divide-x", collapsed && "hidden")}>
        <CodeEditor
          // Remount when the operator swaps in a new template.
          key={`${stage.id}:${stage.operator}`}
          initialValue={stage.body}
          onChange={onBodyChange}
          onSubmit={onRun}
          ariaLabel={t("stage.editor", { number })}
          completions={completionsFor(queryKindOf(stage.operator))}
          className={cn("rounded-bl-lg", tall ? "h-[28rem]" : "h-44")}
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

/** A field worth starting a stage with: a string (good to group or match on), else any. */
function templateField(fields: readonly FieldSummary[]): string | undefined {
  const candidates = fields.filter((field) => field.path !== "_id" && !field.path.includes("."));
  return (candidates.find((field) => field.types[0] === "string") ?? candidates[0])?.path;
}
