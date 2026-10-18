import type { AiOverview } from "@odin-db/bindings";
import { useTranslation } from "react-i18next";
import { formatBytes } from "@/lib/format";
import { useSettingsSearch } from "../hooks/use-settings-search";
import { AiModelRow } from "./ai-model-row";
import { SettingsSection } from "./settings-section";

/** The model catalog with measured accuracy and speed, as a guide to choosing. */
export function AiModelsTable({ overview }: { overview: AiOverview }) {
  const { t, i18n } = useTranslation("settings");
  const search = useSettingsSearch();
  const memoryGib = overview.hardware.memoryGib;
  const models = overview.models.filter(
    ({ spec }) => !search || `${spec.name} ${spec.publisher}`.toLowerCase().includes(search),
  );
  const head = "whitespace-nowrap py-2 pr-4 text-left font-medium text-muted-foreground text-xs";

  return (
    <SettingsSection title={t("ai.models")} description={t("ai.table.guide")}>
      <table className="w-full">
        <thead className="border-b">
          <tr>
            <th scope="col" className={`${head} pl-4`}>
              {t("ai.table.model")}
            </th>
            <th scope="col" className={head}>
              {t("ai.table.accuracy")}
            </th>
            <th scope="col" className={head}>
              {t("ai.table.speed")}
            </th>
            <th scope="col" className={head}>
              {t("ai.table.size")}
            </th>
            <th scope="col" className={head}>
              <span className="sr-only">{t("ai.table.actions")}</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {models.map((entry) => (
            <AiModelRow
              key={entry.spec.id}
              entry={entry}
              recommended={entry.spec.id === overview.recommended}
              memoryGib={memoryGib}
            />
          ))}
        </tbody>
      </table>
      <p className="border-t px-4 py-2.5 text-muted-foreground text-xs">
        {t("ai.modelsHint", {
          memory: memoryGib,
          used: formatBytes(overview.usedBytes ?? 0, i18n.language),
        })}
      </p>
    </SettingsSection>
  );
}
