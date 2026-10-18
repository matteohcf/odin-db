import type { EngineChoice, FieldSummary } from "@odin-db/bindings";
import { Button } from "@odin-db/ui/components/button";
import { Kbd } from "@odin-db/ui/components/kbd";
import { CircleAlert, Loader2, Sparkles, Square } from "lucide-react";
import { useId, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useGenerateQuery } from "../hooks/use-generate-query";
import { examplePrompts } from "../lib/example-prompts";
import { type QueryText, toQueryText } from "../lib/query-text";
import { usePromptHistory } from "../store/prompt-history-store";
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
  const examples = useMemo(() => examplePrompts(fields), [fields]);
  const input = useRef<HTMLTextAreaElement>(null);
  const history = usePromptHistory((s) => s.prompts);
  const record = usePromptHistory((s) => s.record);
  // Position in the history while recalling with Up and Down; -1 is the text being typed.
  const recall = useRef(-1);
  const ask = () => {
    if (!prompt.trim() || running) return;
    record(prompt);
    recall.current = -1;
    void generate(engine, prompt.trim(), collection, fields);
  };

  return (
    <div className="flex flex-col gap-3">
      <label htmlFor={`${id}-prompt`} className="flex items-center gap-1.5 font-medium text-sm">
        <Sparkles className="size-3.5 text-primary" />
        {t("ask.title")}
      </label>
      <textarea
        ref={input}
        id={`${id}-prompt`}
        value={prompt}
        onChange={(event) => {
          recall.current = -1;
          onPromptChange(event.target.value);
        }}
        onKeyDown={(event) => {
          const step = event.key === "ArrowUp" ? 1 : event.key === "ArrowDown" ? -1 : 0;
          // Only from an empty prompt or one recalled, so arrows still move within typed text.
          if (step && (prompt === "" || recall.current >= 0)) {
            const next = recall.current + step;
            if (next >= -1 && next < history.length) {
              event.preventDefault();
              recall.current = next;
              onPromptChange(next === -1 ? "" : (history[next] ?? ""));
            }
            return;
          }
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
      {!prompt && examples.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground text-xs">{t("ask.try")}</span>
          {examples.map((example) => {
            const sentence = t(`ask.examples.${example.kind}`, { field: example.field });
            return (
              <Button
                key={example.kind}
                variant="outline"
                size="xs"
                className="rounded-full font-normal"
                onClick={() => {
                  onPromptChange(sentence);
                  // "contains …" needs its word: select the placeholder so typing replaces it.
                  requestAnimationFrame(() => {
                    const at = sentence.indexOf("…");
                    input.current?.focus();
                    if (at >= 0) input.current?.setSelectionRange(at, at + 1);
                  });
                }}
              >
                {sentence}
              </Button>
            );
          })}
        </div>
      )}
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
