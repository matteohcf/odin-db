import { Button } from "@odin-db/ui/components/button";
import { CircleCheck, Download, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useInstallUpdate, useUpdateCheck } from "@/features/updates";
import { errorMessage } from "@/lib/ipc";
import { useSettings } from "@/lib/settings";
import { SettingRow } from "./setting-row";

/** The update status, a manual check, and the install button when one is available. */
export function UpdateRow() {
  const { t } = useTranslation("updates");
  const { t: tSettings } = useTranslation("settings");
  const automatic = useSettings((s) => s.checkForUpdates);
  // Settings shows the status even when the launch check is off.
  const check = useUpdateCheck(automatic);
  const install = useInstallUpdate();
  const status = check.isFetching
    ? t("checking")
    : check.error
      ? t("checkFailed", { message: errorMessage(check.error) })
      : check.data
        ? t("available", { version: check.data.version })
        : check.isSuccess
          ? t("upToDate")
          : undefined;
  return (
    <SettingRow label={tSettings("about.updates")} description={status}>
      {check.data ? (
        <Button size="sm" onClick={() => check.data && void install(check.data)}>
          <Download />
          {t("install")}
        </Button>
      ) : (
        <Button
          variant="outline"
          size="sm"
          disabled={check.isFetching}
          onClick={() => void check.refetch()}
        >
          {check.isFetching ? (
            <Loader2 className="animate-spin" />
          ) : check.isSuccess ? (
            <CircleCheck />
          ) : null}
          {t("check")}
        </Button>
      )}
    </SettingRow>
  );
}
