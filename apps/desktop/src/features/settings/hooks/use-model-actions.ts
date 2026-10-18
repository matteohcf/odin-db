import { commands, type ModelSpec } from "@odin-db/bindings";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { aiOverviewQuery, useModelDownloads } from "@/features/ai";
import { call, errorMessage } from "@/lib/ipc";
import { useSettings } from "@/lib/settings";

/** Download (or resume), pause, use and delete one catalog model, with toasts for outcomes. */
export function useModelActions(spec: ModelSpec) {
  const { t } = useTranslation("settings");
  const queryClient = useQueryClient();
  const update = useSettings((s) => s.update);
  const start = useModelDownloads((s) => s.start);
  const pause = useModelDownloads((s) => s.pause);
  const refresh = () => queryClient.invalidateQueries({ queryKey: aiOverviewQuery.queryKey });

  async function download() {
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
      if (useSettings.getState().aiLocalModel === spec.id) update({ aiLocalModel: "" });
      await refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  return {
    download,
    remove,
    pause: () => pause(spec.id),
    use: () => update({ aiLocalModel: spec.id }),
  };
}
