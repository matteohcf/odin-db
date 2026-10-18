import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useSettings } from "@/lib/settings";
import { useUpdateCheck } from "../api/queries";
import { useInstallUpdate } from "./use-install-update";

/** At launch, when allowed, offers a newer release in a toast that can install it. */
export function useUpdateNotifier() {
  const { t } = useTranslation("updates");
  const enabled = useSettings((s) => s.checkForUpdates);
  const { data: update } = useUpdateCheck(enabled);
  const install = useInstallUpdate();

  useEffect(() => {
    if (!update) return;
    toast(t("available", { version: update.version }), {
      id: `update-${update.version}`,
      description: t("availableHint", { current: update.currentVersion }),
      duration: Number.POSITIVE_INFINITY,
      action: { label: t("install"), onClick: () => void install(update) },
    });
  }, [update, install, t]);
}
