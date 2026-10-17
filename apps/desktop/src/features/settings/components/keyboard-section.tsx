import { cn } from "@odin-db/ui/lib/utils";
import { useTranslation } from "react-i18next";
import { ShortcutsList } from "@/components/shortcuts-list";
import { useSettingsSearch } from "../hooks/use-settings-search";

export function KeyboardSection() {
  const { t } = useTranslation("settings");
  const search = useSettingsSearch();
  return (
    <section
      className={cn("flex flex-col gap-3", search && "[&:not(:has([data-setting-row]))]:hidden")}
    >
      <div className="flex flex-col gap-0.5">
        <h2 className="font-semibold text-base">{t("keyboard.title")}</h2>
        <p className="text-muted-foreground text-sm">{t("keyboard.description")}</p>
      </div>
      <div className="rounded-lg border bg-card p-4">
        <ShortcutsList filter={search} />
      </div>
    </section>
  );
}
