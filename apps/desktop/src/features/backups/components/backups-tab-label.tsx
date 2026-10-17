import { HardDriveDownload } from "lucide-react";
import { useTranslation } from "react-i18next";

export function BackupsTabLabel() {
  const { t } = useTranslation("backups");
  return (
    <>
      <HardDriveDownload className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{t("title")}</span>
    </>
  );
}
