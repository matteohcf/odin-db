import { Switch } from "@odin-db/ui/components/switch";
import { ToggleGroup, ToggleGroupItem } from "@odin-db/ui/components/toggle-group";
import { Braces, List, Table2 } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { useResultsView } from "@/features/results";
import { ROW_HEIGHTS, type RowDensity, useSettings } from "@/lib/settings";
import { OptionSelect } from "./option-select";
import { SettingRow } from "./setting-row";
import { SettingsSection } from "./settings-section";

export function ResultsSection() {
  const { t } = useTranslation("settings");
  const id = useId();
  const view = useResultsView((s) => s.view);
  const setView = useResultsView((s) => s.setView);
  const batchSize = useSettings((s) => s.resultsBatchSize);
  const maxRows = useSettings((s) => s.resultsMaxRows);
  const rowDensity = useSettings((s) => s.rowDensity);
  const confirmDelete = useSettings((s) => s.confirmDelete);
  const dateDisplay = useSettings((s) => s.dateDisplay);
  const update = useSettings((s) => s.update);
  return (
    <SettingsSection title={t("results.title")} description={t("results.description")}>
      <SettingRow label={t("results.view")} description={t("results.viewHint")}>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={view}
          onValueChange={(value) => value && setView(value as typeof view)}
          aria-label={t("results.view")}
        >
          <ToggleGroupItem value="table" className="gap-1.5 px-3">
            <Table2 className="size-3.5" />
            {t("results.table")}
          </ToggleGroupItem>
          <ToggleGroupItem value="list" className="gap-1.5 px-3">
            <List className="size-3.5" />
            {t("results.list")}
          </ToggleGroupItem>
          <ToggleGroupItem value="json" className="gap-1.5 px-3">
            <Braces className="size-3.5" />
            {t("results.json")}
          </ToggleGroupItem>
        </ToggleGroup>
      </SettingRow>
      <SettingRow label={t("results.density")} description={t("results.densityHint")}>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={rowDensity}
          onValueChange={(value) => value && update({ rowDensity: value as RowDensity })}
          aria-label={t("results.density")}
        >
          {(Object.keys(ROW_HEIGHTS) as RowDensity[]).map((value) => (
            <ToggleGroupItem key={value} value={value} className="px-3">
              {t(`results.densities.${value}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </SettingRow>
      <SettingRow label={t("results.dates")} description={t("results.datesHint")}>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={dateDisplay}
          onValueChange={(value) => value && update({ dateDisplay: value as typeof dateDisplay })}
          aria-label={t("results.dates")}
        >
          <ToggleGroupItem value="utc" className="px-3">
            UTC
          </ToggleGroupItem>
          <ToggleGroupItem value="local" className="px-3">
            {t("results.localTime")}
          </ToggleGroupItem>
        </ToggleGroup>
      </SettingRow>
      <SettingRow
        id={`${id}-confirm-delete`}
        label={t("results.confirmDelete")}
        description={t("results.confirmDeleteHint")}
      >
        <Switch
          id={`${id}-confirm-delete`}
          checked={confirmDelete}
          onCheckedChange={(checked) => update({ confirmDelete: checked })}
        />
      </SettingRow>
      <SettingRow
        id={`${id}-batch`}
        label={t("results.batchSize")}
        description={t("results.batchSizeHint")}
      >
        <OptionSelect
          id={`${id}-batch`}
          value={batchSize}
          options={[50, 100, 250, 500, 1_000] as const}
          onChange={(value) => update({ resultsBatchSize: value })}
          format={(value) => t("results.documents", { count: value })}
        />
      </SettingRow>
      <SettingRow
        id={`${id}-max`}
        label={t("results.maxRows")}
        description={t("results.maxRowsHint")}
      >
        <OptionSelect
          id={`${id}-max`}
          value={maxRows}
          options={[5_000, 10_000, 20_000, 50_000, 100_000] as const}
          onChange={(value) => update({ resultsMaxRows: value })}
          format={(value) => t("results.documents", { count: value })}
        />
      </SettingRow>
    </SettingsSection>
  );
}
