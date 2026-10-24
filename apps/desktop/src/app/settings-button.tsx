import { Button } from "@odin-db/ui/components/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@odin-db/ui/components/tooltip";
import { Settings } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useTabs } from "@/features/workspace";
import { useKeybindingLabel } from "@/hooks/use-keybinding";
import { useShortcut } from "@/hooks/use-shortcut";

/** Sidebar footer entry to the settings, also bound to Mod+,. */
export function SettingsButton() {
  const settingsKeys = useKeybindingLabel("settings");
  const { t } = useTranslation("settings");
  const openSettings = useTabs((s) => s.openSettings);
  useShortcut("settings", () => openSettings());
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto size-7 text-muted-foreground"
          aria-label={t("open")}
          onClick={() => openSettings()}
        >
          <Settings className="size-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">
        {t("open")} {settingsKeys && <span className="ml-1 opacity-70">{settingsKeys}</span>}
      </TooltipContent>
    </Tooltip>
  );
}
