import { commands } from "@odin-db/bindings";
import { Badge } from "@odin-db/ui/components/badge";
import { Button } from "@odin-db/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useQueryHistory } from "@/features/documents";
import { call } from "@/lib/ipc";
import { useSettings } from "@/lib/settings";
import { OptionSelect } from "./option-select";
import { SettingRow } from "./setting-row";
import { SettingsSection } from "./settings-section";

export function DataSection() {
  const { t } = useTranslation("settings");
  const id = useId();
  const historySize = useSettings((s) => s.queryHistorySize);
  const update = useSettings((s) => s.update);
  const clearHistory = useQueryHistory((s) => s.clearAll);
  const tools = useQuery({
    queryKey: ["database-tools-status"],
    queryFn: () => call(commands.databaseToolsStatus()),
  });
  return (
    <>
      <SettingsSection title={t("data.title")} description={t("data.description")}>
        <SettingRow
          id={`${id}-history`}
          label={t("data.historySize")}
          description={t("data.historySizeHint")}
        >
          <OptionSelect
            id={`${id}-history`}
            value={historySize}
            options={[10, 25, 50, 100, 200] as const}
            onChange={(value) => update({ queryHistorySize: value })}
            format={(value) => t("data.queries", { count: value })}
          />
        </SettingRow>
        <SettingRow label={t("data.clearHistory")} description={t("data.clearHistoryHint")}>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              clearHistory();
              toast.success(t("data.historyCleared"));
            }}
          >
            {t("data.clear")}
          </Button>
        </SettingRow>
      </SettingsSection>
      <SettingsSection title={t("tools.title")} description={t("tools.description")}>
        <SettingRow label={t("tools.databaseTools")} description={t("tools.databaseToolsHint")}>
          {tools.data &&
            (tools.data.available ? (
              <Badge variant="secondary" className="font-mono">
                {tools.data.version ?? t("tools.available")}
              </Badge>
            ) : (
              <Badge variant="outline" className="text-warning">
                {t("tools.missing")}
              </Badge>
            ))}
        </SettingRow>
      </SettingsSection>
    </>
  );
}
