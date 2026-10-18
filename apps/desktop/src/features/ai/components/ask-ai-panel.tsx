import type { EngineChoice, FieldSummary } from "@odin-db/bindings";
import { Button } from "@odin-db/ui/components/button";
import { Kbd } from "@odin-db/ui/components/kbd";
import { CircleAlert, Loader2, Sparkles, Square } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { useGenerateQuery } from "../hooks/use-generate-query";
import { type QueryText, toQueryText } from "../lib/query-text";
import { QueryPreview } from "./query-preview";

interface AskAiPanelProps {
  engine: EngineChoice;
  collection: string;
  fields: readonly FieldSummary[];
  prompt: string;
  onPromptChange: (prompt: string) => void;
  onApply: (text: QueryText, run: boolean) => void;
}

const isMac = navigator.userAgent.includes("Mac");

/** A description in, a query out: shown for review, applied only on request. */
export function AskAiPanel({
  engine,
  collection,
  fields,
  prompt,
  onPromptChange,
  onApply,
}: AskAiPanelProps) {
  const { t } = useTranslation("ai");
  const id = useId();
  const { state, query, generate, cancel } = useGenerateQuery();
  const running = state.status === "running";
  const text = query ? toQueryText(query) : null;
  const ask = () => {
    if (prompt.trim() && !running) void generate(engine, prompt.trim(), collection, fields);
  };

  return (
    <div className="flex flex-col gap-3">
      <label htmlFor={`${id}-prompt`} className="flex items-center gap-1.5 font-medium text-sm">
        <Sparkles className="size-3.5 text-primary" />
        {t("ask.title")}
      </label>
      <textarea
        id={`${id}-prompt`}
        value={prompt}
        onChange={(event) => onPromptChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            if (text && (event.metaKey || event.ctrlKey)) onApply(text, true);
            else ask();
          }
        }}
        placeholder={t("ask.placeholder")}
        rows={2}
        maxLength={1000}
        spellCheck={false}
        className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
      />
      {state.status === "failed" && (
        <p role="alert" className="flex items-start gap-1.5 text-destructive text-xs selectable">
          <CircleAlert className="mt-px size-3.5 shrink-0" />
          {state.error}
        </p>
      )}
      {text && <QueryPreview text={text} />}
      <div className="flex items-center gap-2">
        <p className="mr-auto text-muted-foreground text-xs">{t("ask.privacy")}</p>
        {running ? (
          <Button variant="outline" size="sm" onClick={cancel}>
            <Square className="fill-current" />
            {t("ask.stop")}
          </Button>
        ) : text ? (
          <>
            <Button variant="ghost" size="sm" onClick={ask}>
              {t("ask.again")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => onApply(text, false)}>
              {t("ask.apply")}
            </Button>
            <Button size="sm" onClick={() => onApply(text, true)}>
              {t("ask.applyAndRun")}
              <Kbd className="bg-primary-foreground/15 text-primary-foreground">
                {isMac ? "⌘↵" : "Ctrl ↵"}
              </Kbd>
            </Button>
          </>
        ) : (
          <Button size="sm" onClick={ask} disabled={!prompt.trim()}>
            {t("ask.generate")}
            <Kbd className="bg-primary-foreground/15 text-primary-foreground">↵</Kbd>
          </Button>
        )}
        {running && (
          <span className="sr-only" role="status">
            {t("ask.generating")}
          </span>
        )}
        {running && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
      </div>
    </div>
  );
}
