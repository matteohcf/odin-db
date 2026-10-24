import type { FieldSummary } from "@odin-db/bindings";
import { Button } from "@odin-db/ui/components/button";
import { Kbd } from "@odin-db/ui/components/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@odin-db/ui/components/tooltip";
import { cn } from "@odin-db/ui/lib/utils";
import { ChevronDown, Gauge, Loader2, Play, SlidersHorizontal, X } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { QueryEditor } from "@/components/query-editor";
import { AskAiButton } from "@/features/ai";
import { useQueryCompletions } from "@/hooks/use-query-completions";
import { EDIT_SHORTCUTS, label } from "@/lib/shortcuts";
import { emptyQueryForm, type QueryField, type QueryForm } from "../lib/query-form";
import { useQueryHistory } from "../store/query-history-store";
import { QueryFieldFrame } from "./query-field-frame";
import { QueryHistoryMenu } from "./query-history-menu";
import { VisualQueryBuilder } from "./visual-query-builder";

interface QueryBarProps {
  /** The collection's name, which the AI assistant is told. */
  collection: string;
  form: QueryForm;
  errors: Partial<Record<QueryField, string>>;
  running: boolean;
  /** Sampled field paths, for autocompletion. */
  fields: readonly FieldSummary[];
  historyKey: string;
  onChange: (field: QueryField, value: string) => void;
  onRun: () => void;
  /** Replaces the whole form and runs it (history, reset). */
  onRunForm: (form: QueryForm) => void;
  /** Replaces the whole form without running it (arrow-key history). */
  onSetForm: (form: QueryForm) => void;
  onExplain: () => void;
  explaining: boolean;
  /** View actions shown after Run, e.g. Insert document. */
  actions?: ReactNode;
  /** Focuses the filter each time it changes (Mod+F). */
  focusSignal?: number;
  /** Opens the AI assistant each time it changes (Mod+I). */
  askSignal?: number;
}

// Stable, so the store selector does not return a new array on every render.
const NO_ENTRIES: never[] = [];
const hasOptionsIn = (form: QueryForm) =>
  form.sort !== "" || form.projection !== "" || form.skip !== "" || form.limit !== "";

export function QueryBar({
  collection,
  form,
  errors,
  running,
  fields,
  historyKey,
  onChange,
  onRun,
  onRunForm,
  onSetForm,
  onExplain,
  explaining,
  actions,
  focusSignal,
  askSignal,
}: QueryBarProps) {
  const { t } = useTranslation("documents");
  const hasOptions = hasOptionsIn(form);
  const isEmpty = !hasOptions && form.filter.trim() === "";
  const [expanded, setExpanded] = useState(hasOptions);
  // A sort set from outside (a grid header, history) should be visible.
  useEffect(() => {
    if (hasOptions) setExpanded(true);
  }, [hasOptions]);
  const showOptions = expanded || errors.sort || errors.projection || errors.skip || errors.limit;

  const completionsFor = useQueryCompletions(fields);

  // Up and Down walk through recent queries; the form being typed comes back at the end.
  const entries = useQueryHistory((state) => state.entries[historyKey] ?? NO_ENTRIES);
  const recall = useRef<{ index: number; draft: QueryForm }>({ index: -1, draft: form });
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new collection or run starts over.
  useEffect(() => {
    recall.current.index = -1;
  }, [historyKey, entries]);
  const onHistory = (step: 1 | -1) => {
    const next = recall.current.index + step;
    if (next < -1 || next >= entries.length) return false;
    if (recall.current.index === -1) recall.current.draft = form;
    recall.current.index = next;
    onSetForm(next === -1 ? recall.current.draft : (entries[next]?.form ?? form));
    return true;
  };

  const onNumberKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onRun();
    }
  };

  const messages = Object.entries(errors).filter(([, message]) => message);

  return (
    // A container, so labels give way to icons when the tab is narrow, before the filter does.
    <div className="@container flex flex-col gap-2 border-b px-3 py-2.5">
      <div className="flex items-center gap-2">
        <QueryFieldFrame
          label={t("query.filter")}
          invalid={Boolean(errors.filter)}
          className="min-w-56 flex-1"
          end={
            !isEmpty && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("query.reset")}
                title={t("query.resetHint")}
                onClick={() => {
                  setExpanded(false);
                  onRunForm(emptyQueryForm);
                }}
                className="mr-0.5 ml-auto size-6 shrink-0 text-muted-foreground"
              >
                <X />
              </Button>
            )
          }
        >
          <QueryEditor
            value={form.filter}
            onChange={(value) => onChange("filter", value)}
            onSubmit={onRun}
            onHistory={onHistory}
            completions={completionsFor("filter")}
            placeholder={t("query.filterPlaceholder")}
            ariaLabel={t("query.filter")}
            invalid={Boolean(errors.filter)}
            autoFocus
            {...(focusSignal ? { focusSignal } : {})}
          />
        </QueryFieldFrame>
        <AskAiButton
          collection={collection}
          fields={fields}
          onApply={(text, run) => {
            const next = { ...form, ...text, skip: "" };
            if (run) onRunForm(next);
            else onSetForm(next);
          }}
          {...(askSignal ? { openSignal: askSignal } : {})}
        />
        <VisualQueryBuilder
          fields={fields}
          onApply={(filter, run) =>
            run ? onRunForm({ ...form, filter }) : onChange("filter", filter)
          }
        />
        <QueryHistoryMenu historyKey={historyKey} onSelect={onRunForm} />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("explain.open")}
              disabled={explaining}
              onClick={onExplain}
              className="text-muted-foreground"
            >
              {explaining ? <Loader2 className="animate-spin" /> : <Gauge />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("explain.open")}</TooltipContent>
        </Tooltip>
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={Boolean(showOptions)}
          aria-label={t("query.options")}
          title={t("query.options")}
          onClick={() => setExpanded((value) => !value)}
          className={cn("relative text-muted-foreground", hasOptions && "text-foreground")}
        >
          <SlidersHorizontal className="@4xl:hidden" />
          <span className="hidden @4xl:inline">{t("query.options")}</span>
          <ChevronDown
            className={cn("hidden transition-transform @4xl:block", showOptions && "rotate-180")}
          />
          {hasOptions && (
            <span className="absolute top-1 right-1 size-1.5 rounded-full bg-primary @4xl:hidden" />
          )}
        </Button>
        <Button size="sm" onClick={onRun} disabled={running} title={t("query.runShortcut")}>
          <Play className="fill-current" />
          {t("query.run")}
          <Kbd className="hidden bg-primary-foreground/15 text-primary-foreground @3xl:inline-flex">
            {label(EDIT_SHORTCUTS.submit)}
          </Kbd>
        </Button>
        {actions && (
          <>
            <div className="mx-1 h-5 w-px bg-border" />
            {actions}
          </>
        )}
      </div>

      {showOptions && (
        <div className="flex items-center gap-2">
          <QueryFieldFrame
            label={t("query.sort")}
            invalid={Boolean(errors.sort)}
            className="flex-1"
          >
            <QueryEditor
              value={form.sort}
              onChange={(value) => onChange("sort", value)}
              onSubmit={onRun}
              completions={completionsFor("sort")}
              placeholder={t("query.sortPlaceholder")}
              ariaLabel={t("query.sort")}
              invalid={Boolean(errors.sort)}
            />
          </QueryFieldFrame>
          <QueryFieldFrame
            label={t("query.projection")}
            invalid={Boolean(errors.projection)}
            className="flex-1"
          >
            <QueryEditor
              value={form.projection}
              onChange={(value) => onChange("projection", value)}
              onSubmit={onRun}
              completions={completionsFor("projection")}
              placeholder={t("query.projectionPlaceholder")}
              ariaLabel={t("query.projection")}
              invalid={Boolean(errors.projection)}
            />
          </QueryFieldFrame>
          {(["skip", "limit"] as const).map((field) => (
            <QueryFieldFrame
              key={field}
              label={t(`query.${field}`)}
              invalid={Boolean(errors[field])}
              className="w-28"
            >
              <input
                value={form[field]}
                placeholder={t("query.numberPlaceholder")}
                onChange={(event) => onChange(field, event.target.value)}
                onKeyDown={onNumberKeyDown}
                aria-label={t(`query.${field}`)}
                aria-invalid={errors[field] !== undefined}
                inputMode="numeric"
                autoComplete="off"
                className="h-full min-w-0 flex-1 bg-transparent pr-2.5 font-mono text-xs outline-none placeholder:text-muted-foreground/60"
              />
            </QueryFieldFrame>
          ))}
        </div>
      )}

      {messages.length > 0 && (
        <ul role="alert" className="flex flex-col gap-0.5 text-destructive text-xs selectable">
          {messages.map(([field, message]) => (
            <li key={field}>
              <span className="font-medium">{t(`query.${field as QueryField}`)}:</span> {message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
