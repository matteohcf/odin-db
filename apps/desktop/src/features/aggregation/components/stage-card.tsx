import type { ConnectionId, FieldSummary, Namespace } from "@odin-db/bindings";
import { Button } from "@odin-db/ui/components/button";
import { Switch } from "@odin-db/ui/components/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@odin-db/ui/components/tooltip";
import { cn } from "@odin-db/ui/lib/utils";
import { ArrowDown, ArrowUp, CircleAlert, Loader2, Plus, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CodeEditor } from "@/components/code-editor";
import { useQueryCompletions } from "@/hooks/use-query-completions";
import { describeEJson } from "@/lib/ejson-display";
import { errorMessage } from "@/lib/ipc";
import { useStageInputFields } from "../api/use-stage-input-fields";
import {
  PREVIEW_LIMIT,
  PREVIEW_SAMPLE,
  StageSyntaxError,
  useStagePreview,
} from "../api/use-stage-preview";
import { isWriteOperator, queryKindOf } from "../lib/operators";
import type { Stage } from "../lib/pipeline";
import { OperatorPicker } from "./operator-picker";

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

function StagePreview({
  connectionId,
  namespace,
  stages,
  index,
}: {
  connectionId: ConnectionId;
  namespace: Namespace;
  stages: readonly Stage[];
  index: number;
}) {
  const { t } = useTranslation("aggregation");
  const stage = stages[index];
  const preview = useStagePreview(connectionId, namespace, stages, index);
  const writes = stages.slice(0, index + 1).some((s) => s.enabled && isWriteOperator(s.operator));

  let body: ReactNode;
  if (!stage?.enabled) body = <Note>{t("stage.disabled")}</Note>;
  else if (writes) body = <Note>{t("preview.writeStage")}</Note>;
  else if (preview.error) {
    const error = preview.error;
    const failing =
      error instanceof StageSyntaxError ? stages.findIndex((s) => s.id === error.stageId) : -1;
    body = (
      <Note tone="error">
        {failing >= 0 && failing !== index
          ? t("preview.fixStage", { number: failing + 1 })
          : t("preview.failed", { message: errorMessage(error) })}
      </Note>
    );
  } else if (!preview.data) body = <Note>{t("preview.loading")}</Note>;
  else if (preview.data.length === 0) body = <Note>{t("preview.empty")}</Note>;
  else {
    body = (
      <ol className="flex flex-col gap-1 p-2">
        {preview.data.map((document, position) => {
          const text = describeEJson(document).text;
          return (
            // Preview rows are positional snapshots without stable ids, replaced as a whole.
            <li
              key={position}
              title={text}
              className="truncate rounded-sm bg-muted/60 px-2 py-1 font-mono text-[11px] selectable"
            >
              {text}
            </li>
          );
        })}
      </ol>
    );
  }

  return (
    <div className="flex h-44 min-w-0 flex-col">
      <div className="flex h-7 shrink-0 items-center gap-2 border-b px-2 text-muted-foreground text-xs">
        {preview.data && stage?.enabled && !writes ? (
          <>
            <span className="text-foreground">
              {t("preview.title", { count: preview.data.length })}
            </span>
            <span className="truncate">
              {t("preview.sampleNote", {
                limit: PREVIEW_LIMIT,
                sample: PREVIEW_SAMPLE.toLocaleString(),
              })}
            </span>
          </>
        ) : null}
        {preview.isFetching && <Loader2 className="ml-auto size-3 animate-spin" />}
      </div>
      <section
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be focusable to scroll from the keyboard (WCAG 2.1.1).
        tabIndex={0}
        aria-label={t("preview.label")}
        className="min-h-0 flex-1 overflow-y-auto outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        {body}
      </section>
    </div>
  );
}

function Note({ children, tone }: { children: ReactNode; tone?: "error" }) {
  return (
    <p
      className={cn(
        "flex items-start gap-1.5 p-3 text-xs",
        tone === "error" ? "text-destructive selectable" : "text-muted-foreground",
      )}
    >
      {tone === "error" && <CircleAlert className="mt-px size-3.5 shrink-0" />}
      {children}
    </p>
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
