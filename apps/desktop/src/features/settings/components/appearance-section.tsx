import { type Theme, useTheme } from "@odin-db/ui/components/theme-provider";
import { ToggleGroup, ToggleGroupItem } from "@odin-db/ui/components/toggle-group";
import { cn } from "@odin-db/ui/lib/utils";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { ACCENTS, useSettings, ZOOM_LEVELS } from "@/lib/settings";
import { label, SHORTCUTS } from "@/lib/shortcuts";
import { OptionSelect } from "./option-select";
import { SettingRow } from "./setting-row";
import { SettingsSection } from "./settings-section";

const THEMES = [
  ["system", Monitor],
  ["light", Sun],
  ["dark", Moon],
] as const;

export function AppearanceSection() {
  const { t } = useTranslation("settings");
  const id = useId();
  const { theme, setTheme } = useTheme();
  const zoom = useSettings((s) => s.zoom);
  const accent = useSettings((s) => s.accent);
  const darkStyle = useSettings((s) => s.darkStyle);
  const update = useSettings((s) => s.update);
  return (
    <SettingsSection title={t("appearance.title")}>
      <SettingRow label={t("appearance.theme")} description={t("appearance.themeHint")}>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={theme}
          onValueChange={(value) => value && setTheme(value as Theme)}
          aria-label={t("appearance.theme")}
        >
          {THEMES.map(([value, Icon]) => (
            <ToggleGroupItem key={value} value={value} className="gap-1.5 px-3">
              <Icon className="size-3.5" />
              {t(`theme.${value}`, { ns: "common" })}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </SettingRow>
      <SettingRow label={t("appearance.accent")} description={t("appearance.accentHint")}>
        <ToggleGroup
          type="single"
          value={accent}
          onValueChange={(value) => value && update({ accent: value as typeof accent })}
          aria-label={t("appearance.accent")}
          className="gap-1.5"
        >
          {ACCENTS.map((value) => (
            <ToggleGroupItem
              key={value}
              value={value}
              aria-label={t(`appearance.accents.${value}`)}
              title={t(`appearance.accents.${value}`)}
              // Each swatch previews its accent through the same token rules as the app.
              data-accent={value}
              className={cn(
                "size-6 min-w-6 rounded-full! bg-primary p-0 text-primary-foreground hover:bg-primary hover:text-primary-foreground data-[state=on]:bg-primary data-[state=on]:text-primary-foreground",
                accent === value && "ring-2 ring-primary ring-offset-2 ring-offset-background",
              )}
            >
              {accent === value && <Check className="size-3.5" />}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </SettingRow>
      <SettingRow label={t("appearance.darkStyle")} description={t("appearance.darkStyleHint")}>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={darkStyle}
          onValueChange={(value) => value && update({ darkStyle: value as typeof darkStyle })}
          aria-label={t("appearance.darkStyle")}
        >
          <ToggleGroupItem value="graphite" className="px-3">
            {t("appearance.graphite")}
          </ToggleGroupItem>
          <ToggleGroupItem value="black" className="px-3">
            {t("appearance.black")}
          </ToggleGroupItem>
        </ToggleGroup>
      </SettingRow>
      <SettingRow
        id={`${id}-zoom`}
        label={t("appearance.zoom")}
        description={t("appearance.zoomHint", {
          zoomOut: label(SHORTCUTS.zoomOut),
          reset: label(SHORTCUTS.resetZoom),
        })}
      >
        <OptionSelect
          id={`${id}-zoom`}
          value={zoom}
          options={
            ZOOM_LEVELS.includes(zoom as (typeof ZOOM_LEVELS)[number])
              ? ZOOM_LEVELS
              : [...ZOOM_LEVELS, zoom]
          }
          onChange={(value) => update({ zoom: value })}
          format={(value) => `${value}%`}
          className="w-28"
        />
      </SettingRow>
    </SettingsSection>
  );
}
