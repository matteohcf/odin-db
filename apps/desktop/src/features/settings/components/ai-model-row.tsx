import type { ModelEntry } from "@odin-db/bindings";
import { commands } from "@odin-db/bindings";
import { Badge } from "@odin-db/ui/components/badge";
import { Button } from "@odin-db/ui/components/button";
import { Progress } from "@odin-db/ui/components/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@odin-db/ui/components/tooltip";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Download, Pause, Play, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { aiOverviewQuery, useModelDownloads } from "@/features/ai";
import { formatBytes } from "@/lib/format";
import { call, errorMessage } from "@/lib/ipc";
import { useSettings } from "@/lib/settings";
import { SettingRow } from "./setting-row";

interface AiModelRowProps {
  entry: ModelEntry;
  recommended: boolean;
}

/** One catalog model: what it is, and download, pause, use or delete it. */
export function AiModelRow({ entry: { spec, state }, recommended }: AiModelRowProps) {
  const { t, i18n } = useTranslation("settings");
  const queryClient = useQueryClient();
  const selected = useSettings((s) => s.aiLocalModel) === spec.id;
  const update = useSettings((s) => s.update);
  const download = useModelDownloads((s) => s.downloads[spec.id]);
  const start = useModelDownloads((s) => s.start);
  const pause = useModelDownloads((s) => s.pause);
  const size = (bytes: number) => formatBytes(bytes, i18n.language);
  // f64 crosses IPC as nullable (NaN has no JSON form).
  const total = spec.size ?? 0;
  const refresh = () => queryClient.invalidateQueries({ queryKey: aiOverviewQuery.queryKey });

  async function fetchModel() {
    const outcome = await start(spec.id);
    await refresh();
    if (outcome.status === "installed") {
      // The first model downloaded is the one to use.
      if (!useSettings.getState().aiLocalModel) update({ aiLocalModel: spec.id });
      toast.success(t("ai.downloaded", { name: spec.name }));
    } else if (outcome.status === "failed") {
      toast.error(outcome.error);
    }
  }

  async function remove() {
    try {
      await call(commands.deleteAiModel(spec.id));
      if (selected) update({ aiLocalModel: "" });
      await refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  const received = download?.progress?.received ?? (state.state === "partial" ? state.received : 0);
  const description = download ? (
    <span className="flex flex-col gap-1.5 pt-1">
      <Progress
        value={total > 0 ? ((received ?? 0) / total) * 100 : null}
        aria-label={t("ai.downloading", { name: spec.name })}
        className="h-1.5 w-56"
      />
      <span className="tabular-nums">
        {t("ai.progress", { received: size(received ?? 0), total: size(total) })}
      </span>
    </span>
  ) : (
    t("ai.modelDetails", {
      publisher: spec.publisher,
      size: size(total),
      license: spec.license,
    })
  );

  return (
    <SettingRow
      label={spec.name}
      badges={
        <>
          <Badge variant="outline">{t(`ai.tiers.${spec.tier}`)}</Badge>
          {recommended && <Badge>{t("ai.recommended")}</Badge>}
        </>
      }
      description={description}
    >
      {download ? (
        <Button variant="outline" size="sm" onClick={() => pause(spec.id)}>
          <Pause />
          {t("ai.pause")}
        </Button>
      ) : state.state === "installed" ? (
        selected ? (
          <span className="flex items-center gap-1 text-primary text-xs font-medium">
            <Check className="size-3.5" />
            {t("ai.inUse")}
          </span>
        ) : (
          <Button variant="outline" size="sm" onClick={() => update({ aiLocalModel: spec.id })}>
            {t("ai.use")}
          </Button>
        )
      ) : (
        <Button variant="outline" size="sm" onClick={() => void fetchModel()}>
          {state.state === "partial" ? <Play /> : <Download />}
          {state.state === "partial" ? t("ai.resume") : t("ai.download")}
        </Button>
      )}
      {!download && state.state !== "absent" && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("ai.delete", { name: spec.name })}
              className="text-muted-foreground"
              onClick={() => void remove()}
            >
              <Trash2 />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("ai.delete", { name: spec.name })}</TooltipContent>
        </Tooltip>
      )}
    </SettingRow>
  );
}
