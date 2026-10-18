import type { FieldSummary } from "@odin-db/bindings";
import { Button } from "@odin-db/ui/components/button";
import { Popover, PopoverContent, PopoverTrigger } from "@odin-db/ui/components/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@odin-db/ui/components/tooltip";
import { Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { useSettings } from "@/lib/settings";
import { label, SHORTCUTS } from "@/lib/shortcuts";
import { engineFrom } from "../lib/engine";
import type { QueryText } from "../lib/query-text";
import { AiSetupHint } from "./ai-setup-hint";
import { AskAiPanel } from "./ask-ai-panel";

interface AskAiButtonProps {
  collection: string;
  /** Sampled fields: their paths and types tell the model what exists. */
  fields: readonly FieldSummary[];
  onApply: (text: QueryText, run: boolean) => void;
  /** Opens the popover each time it changes (Mod+I). */
  openSignal?: number;
}

/** "Ask AI" in the query bar; hidden when the assistant is turned off in settings. */
export function AskAiButton({ collection, fields, onApply, openSignal }: AskAiButtonProps) {
  const { t } = useTranslation("ai");
  const enabled = useSettings((s) => s.aiEnabled);
  const engine = useSettings(useShallow(engineFrom));
  const [open, setOpen] = useState(false);
  // Kept while the popover is closed, so a request can be refined.
  const [prompt, setPrompt] = useState("");
  useEffect(() => {
    if (openSignal) setOpen(true);
  }, [openSignal]);
  if (!enabled) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("ask.open")}
              className="text-muted-foreground"
            >
              <Sparkles />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>
          {t("ask.open")} <span className="ml-1 opacity-70">{label(SHORTCUTS.askAi)}</span>
        </TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-[34rem]">
        {engine ? (
          <AskAiPanel
            engine={engine}
            collection={collection}
            fields={fields}
            prompt={prompt}
            onPromptChange={setPrompt}
            onApply={(text, run) => {
              onApply(text, run);
              setOpen(false);
            }}
          />
        ) : (
          <AiSetupHint onDone={() => setOpen(false)} />
        )}
      </PopoverContent>
    </Popover>
  );
}
