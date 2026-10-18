import type { UpdateInfo } from "@odin-db/bindings";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { errorMessage } from "@/lib/ipc";
import { installUpdate, percentOf } from "../lib/install-update";

/** Installs an update while one toast shows its progress, a Cancel button and the outcome. */
export function useInstallUpdate() {
  const { t } = useTranslation("updates");
  return async (update: UpdateInfo) => {
    const id = `update-${update.version}`;
    try {
      const handle = await installUpdate((progress) => {
        const percent = percentOf(progress);
        toast.loading(
          percent === null
            ? t("installing", { version: update.version })
            : t("installingPercent", { version: update.version, percent }),
          { id, action: { label: t("cancel"), onClick: () => void handle.cancel() } },
        );
      });
      toast.loading(t("installing", { version: update.version }), {
        id,
        action: { label: t("cancel"), onClick: () => void handle.cancel() },
      });
      const outcome = await handle.done;
      if (outcome.status === "cancelled") toast.info(t("cancelled"), { id });
      else if (outcome.status === "failed")
        toast.error(errorMessage(outcome.error.message), { id });
    } catch (error) {
      toast.error(errorMessage(error), { id });
    }
  };
}
