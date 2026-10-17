import type { FieldSummary } from "@odin-db/bindings";
import { Button } from "@odin-db/ui/components/button";
import { Kbd } from "@odin-db/ui/components/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@odin-db/ui/components/tooltip";
import { cn } from "@odin-db/ui/lib/utils";
import { ChevronDown, Gauge, Loader2, Play } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { QueryEditor } from "@/components/query-editor";
import { useQueryCompletions } from "@/hooks/use-query-completions";
import { emptyQueryForm, type QueryField, type QueryForm } from "../lib/query-form";
import { QueryFieldFrame } from "./query-field-frame";
import { QueryHistoryMenu } from "./query-history-menu";

interface QueryBarProps {
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
  onExplain: () => void;
  explaining: boolean;
  /** View actions shown after Run, e.g. Insert document. */
  actions?: ReactNode;
}

const isMac = navigator.userAgent.includes("Mac");
const hasOptionsIn = (form: QueryForm) =>
  form.sort !== "" || form.projection !== "" || form.skip !== "" || form.limit !== "";

export function QueryBar({
  form,
  errors,
  running,
  fields,
  historyKey,
  onChange,
  onRun,
  onRunForm,
  onExplain,
  explaining,
  actions,
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

  const onNumberKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onRun();
    }
  };

  const messages = Object.entries(errors).filter(([, message]) => message);

  return (
    <div className="flex flex-col gap-2 border-b px-3 py-2.5">
      <div className="flex items-center gap-2">
        <QueryFieldFrame
          label={t("query.filter")}
          invalid={Boolean(errors.filter)}
          className="flex-1"
        >
          <QueryEditor
            value={form.filter}
            onChange={(value) => onChange("filter", value)}
            onSubmit={onRun}
            completions={completionsFor("filter")}
            placeholder={t("query.filterPlaceholder")}
            ariaLabel={t("query.filter")}
            invalid={Boolean(errors.filter)}
            autoFocus
          />
        </QueryFieldFrame>
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
          onClick={() => setExpanded((value) => !value)}
          className={cn("text-muted-foreground", hasOptions && "text-foreground")}
        >
          {t("query.options")}
          <ChevronDown className={cn("transition-transform", showOptions && "rotate-180")} />
        </Button>
        {!isEmpty && (
          <Button
            variant="ghost"
            size="sm"
            title={t("query.resetHint")}
            onClick={() => {
              setExpanded(false);
              onRunForm(emptyQueryForm);
            }}
          >
            {t("query.reset")}
          </Button>
        )}
        <Button size="sm" onClick={onRun} disabled={running} title={t("query.runShortcut")}>
          <Play className="fill-current" />
          {t("query.run")}
          <Kbd className="bg-primary-foreground/15 text-primary-foreground">
            {isMac ? "⌘↵" : "Ctrl ↵"}
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
