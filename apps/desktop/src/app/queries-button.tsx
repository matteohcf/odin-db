import { Button } from "@odin-db/ui/components/button";
import { BookMarked } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useTabs } from "@/features/workspace";

/** Sidebar footer entry to every saved query and pipeline. */
export function QueriesButton() {
  const { t } = useTranslation("queries");
  const openQueries = useTabs((s) => s.openQueries);
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 gap-1.5 px-2 text-muted-foreground text-xs"
      onClick={openQueries}
    >
      <BookMarked className="size-3.5" />
      {t("button")}
    </Button>
  );
}
