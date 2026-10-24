import { Button } from "@odin-db/ui/components/button";
import { cn } from "@odin-db/ui/lib/utils";
import { RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ShortcutsList } from "@/components/shortcuts-list";
import { resetKeybindings } from "@/lib/keybindings";
import { useSettings } from "@/lib/settings";
import { useSettingsSearch } from "../hooks/use-settings-search";

export function KeyboardSection() {
  const { t } = useTranslation("settings");
  const { t: common } = useTranslation("common");
  const search = useSettingsSearch();
  const changed = useSettings((state) => Object.keys(state.keybindings).length);
  return (
    <section
      className={cn("flex flex-col gap-3", search && "[&:not(:has([data-setting-row]))]:hidden")}
    >
      <div className="flex items-end justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <h2 className="font-semibold text-base">{t("keyboard.title")}</h2>
          <p className="text-muted-foreground text-sm">{t("keyboard.description")}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {changed > 0 && (
            <span className="text-muted-foreground text-xs">
              {common("shortcuts.changed", { count: changed })}
            </span>
          )}
          <Button variant="outline" size="sm" disabled={changed === 0} onClick={resetKeybindings}>
            <RotateCcw />
            {common("shortcuts.resetAll")}
          </Button>
        </div>
      </div>
      <div className="rounded-lg border bg-card px-4 py-3">
        <ShortcutsList filter={search} editable />
      </div>
    </section>
  );
}
