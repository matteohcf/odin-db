import { BookMarked } from "lucide-react";
import { useTranslation } from "react-i18next";

export function QueriesTabLabel() {
  const { t } = useTranslation("queries");
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <BookMarked className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{t("title")}</span>
    </span>
  );
}
