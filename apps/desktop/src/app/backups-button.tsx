import { Button } from "@odin-db/ui/components/button";
import { HardDriveDownload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useTabs } from "@/features/workspace";

/** Sidebar footer entry to backup history and schedules. */
export function BackupsButton() {
  const { t } = useTranslation("backups");
  const openBackups = useTabs((s) => s.openBackups);
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 gap-1.5 px-2 text-muted-foreground text-xs"
      onClick={openBackups}
    >
      <HardDriveDownload className="size-3.5" />
      {t("title")}
    </Button>
  );
}
