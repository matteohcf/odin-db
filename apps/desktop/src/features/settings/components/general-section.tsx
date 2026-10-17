import { Switch } from "@odin-db/ui/components/switch";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { LANGUAGES, resolveLanguage } from "@/lib/i18n";
import { type Settings, useSettings } from "@/lib/settings";
import { OptionSelect } from "./option-select";
import { SettingRow } from "./setting-row";
import { SettingsSection } from "./settings-section";

const LANGUAGE_OPTIONS = ["system", ...Object.keys(LANGUAGES)] as Settings["language"][];

export function GeneralSection() {
  const { t } = useTranslation("settings");
  const id = useId();
  const language = useSettings((s) => s.language);
  const reconnect = useSettings((s) => s.reconnectOnLaunch);
  const update = useSettings((s) => s.update);
  return (
    <SettingsSection title={t("general.title")}>
      <SettingRow
        id={`${id}-language`}
        label={t("general.language")}
        description={t("general.languageHint")}
      >
        <OptionSelect
          id={`${id}-language`}
          value={language}
          options={LANGUAGE_OPTIONS}
          onChange={(value) => update({ language: value })}
          format={(value) =>
            value === "system"
              ? t("general.systemLanguage", { language: LANGUAGES[resolveLanguage("system")] })
              : LANGUAGES[value]
          }
          className="w-52"
        />
      </SettingRow>
      <SettingRow
        id={`${id}-reconnect`}
        label={t("general.reconnect")}
        description={t("general.reconnectHint")}
      >
        <Switch
          id={`${id}-reconnect`}
          checked={reconnect}
          onCheckedChange={(checked) => update({ reconnectOnLaunch: checked })}
        />
      </SettingRow>
    </SettingsSection>
  );
}
