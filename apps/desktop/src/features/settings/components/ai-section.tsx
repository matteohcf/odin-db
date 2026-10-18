import { commands } from "@odin-db/bindings";
import { Switch } from "@odin-db/ui/components/switch";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { useAiOverview } from "@/features/ai";
import { formatBytes } from "@/lib/format";
import { type Settings, useSettings } from "@/lib/settings";
import { AiModelRow } from "./ai-model-row";
import { OllamaRows } from "./ollama-rows";
import { OptionSelect } from "./option-select";
import { SettingRow } from "./setting-row";
import { SettingsSection } from "./settings-section";

const ENGINES: Settings["aiEngine"][] = ["local", "ollama"];

/** The AI query assistant: on or off, and which model writes the queries. */
export function AiSection() {
  const { t, i18n } = useTranslation("settings");
  const id = useId();
  const enabled = useSettings((s) => s.aiEnabled);
  const engine = useSettings((s) => s.aiEngine);
  const update = useSettings((s) => s.update);
  const overview = useAiOverview();
  const hardware = overview.data?.hardware;

  return (
    <>
      <SettingsSection title={t("ai.title")} description={t("ai.description")}>
        <SettingRow id={`${id}-enabled`} label={t("ai.enabled")} description={t("ai.enabledHint")}>
          <Switch
            id={`${id}-enabled`}
            checked={enabled}
            onCheckedChange={(checked) => {
              update({ aiEnabled: checked });
              // Off means off: the model's memory is given back right away.
              if (!checked) void commands.unloadAiModel();
            }}
          />
        </SettingRow>
        {enabled && (
          <SettingRow
            id={`${id}-engine`}
            label={t("ai.engine")}
            description={t(`ai.engineHint.${engine}`)}
          >
            <OptionSelect
              id={`${id}-engine`}
              value={engine}
              options={ENGINES}
              onChange={(value) => update({ aiEngine: value })}
              format={(value) => t(`ai.engines.${value}`)}
              className="w-52"
            />
          </SettingRow>
        )}
        {enabled && engine === "ollama" && <OllamaRows />}
      </SettingsSection>
      {enabled && engine === "local" && overview.data && (
        <SettingsSection
          title={t("ai.models")}
          description={t("ai.modelsHint", {
            memory: hardware?.memoryGib ?? 0,
            used: formatBytes(overview.data.usedBytes ?? 0, i18n.language),
          })}
        >
          {overview.data.models.map((entry) => (
            <AiModelRow
              key={entry.spec.id}
              entry={entry}
              recommended={entry.spec.id === overview.data.recommended}
            />
          ))}
        </SettingsSection>
      )}
    </>
  );
}
