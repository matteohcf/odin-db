import { Button } from "@odin-db/ui/components/button";
import { Kbd } from "@odin-db/ui/components/kbd";
import { cn } from "@odin-db/ui/lib/utils";
import { ChevronDown, Play } from "lucide-react";
import { type KeyboardEvent, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { QueryField, QueryForm } from "../lib/query-form";

interface QueryBarProps {
  form: QueryForm;
  errors: Partial<Record<QueryField, string>>;
  running: boolean;
  onChange: (field: QueryField, value: string) => void;
  onRun: () => void;
}

const isMac = navigator.userAgent.includes("Mac");

export function QueryBar({ form, errors, running, onChange, onRun }: QueryBarProps) {
  const { t } = useTranslation("documents");
  const hasOptions =
    form.sort !== "" || form.projection !== "" || form.skip !== "" || form.limit !== "";
  const [expanded, setExpanded] = useState(hasOptions);
  const showOptions = expanded || errors.sort || errors.projection || errors.skip || errors.limit;

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onRun();
    }
  };

  const messages = Object.entries(errors).filter(([, message]) => message);

  return (
    <div className="flex flex-col gap-2 border-b px-3 py-2.5">
      <div className="flex items-center gap-2">
        <QueryInput
          field="filter"
          label={t("query.filter")}
          value={form.filter}
          placeholder={t("query.filterPlaceholder")}
          error={errors.filter}
          onChange={onChange}
          onKeyDown={onKeyDown}
          className="flex-1"
          autoFocus
        />
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
        <Button size="sm" onClick={onRun} disabled={running} title={t("query.runShortcut")}>
          <Play className="fill-current" />
          {t("query.run")}
          <Kbd className="bg-primary-foreground/15 text-primary-foreground">
            {isMac ? "⌘↵" : "Ctrl ↵"}
          </Kbd>
        </Button>
      </div>

      {showOptions && (
        <div className="flex items-center gap-2">
          <QueryInput
            field="sort"
            label={t("query.sort")}
            value={form.sort}
            placeholder={t("query.sortPlaceholder")}
            error={errors.sort}
            onChange={onChange}
            onKeyDown={onKeyDown}
            className="flex-1"
          />
          <QueryInput
            field="projection"
            label={t("query.projection")}
            value={form.projection}
            placeholder={t("query.projectionPlaceholder")}
            error={errors.projection}
            onChange={onChange}
            onKeyDown={onKeyDown}
            className="flex-1"
          />
          <QueryInput
            field="skip"
            label={t("query.skip")}
            value={form.skip}
            placeholder={t("query.numberPlaceholder")}
            error={errors.skip}
            onChange={onChange}
            onKeyDown={onKeyDown}
            className="w-28"
            inputMode="numeric"
          />
          <QueryInput
            field="limit"
            label={t("query.limit")}
            value={form.limit}
            placeholder={t("query.numberPlaceholder")}
            error={errors.limit}
            onChange={onChange}
            onKeyDown={onKeyDown}
            className="w-28"
            inputMode="numeric"
          />
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

interface QueryInputProps {
  field: QueryField;
  label: string;
  value: string;
  placeholder: string;
  error: string | undefined;
  onChange: (field: QueryField, value: string) => void;
  onKeyDown: (event: KeyboardEvent) => void;
  className?: string;
  autoFocus?: boolean;
  inputMode?: "numeric";
}

/** An input with its label inside the frame, like a terminal prompt. */
function QueryInput({
  field,
  label,
  value,
  placeholder,
  error,
  onChange,
  onKeyDown,
  className,
  autoFocus,
  inputMode,
}: QueryInputProps) {
  const id = useId();
  return (
    <div
      className={cn(
        "flex h-8 min-w-0 items-center rounded-md border bg-background shadow-xs transition-colors focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/40",
        error &&
          "border-destructive focus-within:border-destructive focus-within:ring-destructive/20",
        className,
      )}
    >
      <label htmlFor={id} className="shrink-0 pr-2 pl-2.5 text-muted-foreground text-xs">
        {label}
      </label>
      <input
        id={id}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(field, event.target.value)}
        onKeyDown={onKeyDown}
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="off"
        // biome-ignore lint/a11y/noAutofocus: the filter is the primary action of a new collection tab.
        autoFocus={autoFocus}
        inputMode={inputMode}
        aria-invalid={error !== undefined}
        className="h-full min-w-0 flex-1 bg-transparent pr-2.5 font-mono text-xs outline-none placeholder:text-muted-foreground/60"
      />
    </div>
  );
}
