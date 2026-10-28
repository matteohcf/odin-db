import type { ModelEntry } from "@odin-db/bindings";
import { Button } from "@odin-db/ui/components/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@odin-db/ui/components/tooltip";
import { Check, Download, Pause, Play, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useModelDownloads } from "@/features/ai";
import { useSettings } from "@/lib/settings";
import { useModelActions } from "../hooks/use-model-actions";

/** What can be done with a model in its current state. */
export function AiModelActions({ entry: { spec, state } }: { entry: ModelEntry }) {
  const { t } = useTranslation("settings");
  const selected = useSettings((s) => s.aiLocalModel) === spec.id;
  const downloading = useModelDownloads((s) => spec.id in s.downloads);
  const actions = useModelActions(spec);

  return (
    <div className="flex items-center justify-end gap-1.5">
      {downloading ? (
        <Button variant="outline" size="sm" onClick={actions.pause}>
          <Pause />
          {t("ai.pause")}
        </Button>
      ) : state.kind === "installed" ? (
        selected ? (
          <span className="flex items-center gap-1 px-2 font-medium text-primary text-xs">
            <Check className="size-3.5" />
            {t("ai.inUse")}
          </span>
        ) : (
          <Button variant="outline" size="sm" onClick={actions.use}>
            {t("ai.use")}
          </Button>
        )
      ) : (
        <Button variant="outline" size="sm" onClick={() => void actions.download()}>
          {state.kind === "partial" ? <Play /> : <Download />}
          {state.kind === "partial" ? t("ai.resume") : t("ai.download")}
        </Button>
      )}
      {!downloading && state.kind !== "absent" && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("ai.delete", { name: spec.name })}
              className="text-muted-foreground"
              onClick={() => void actions.remove()}
            >
              <Trash2 />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("ai.delete", { name: spec.name })}</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
