import { Settings } from "lucide-react";
import { useTranslation } from "react-i18next";

export function SettingsTabLabel() {
  const { t } = useTranslation("settings");
  return (
    <>
      <Settings className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{t("title")}</span>
    </>
  );
}
