import { commands } from "@odin-db/bindings";
import { Badge } from "@odin-db/ui/components/badge";
import { Button } from "@odin-db/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useClearDiagramScans } from "@/features/diagram";
import { useQueryHistory } from "@/features/documents";
import { call, errorMessage } from "@/lib/ipc";
import { useSettings } from "@/lib/settings";
import { OptionSelect } from "./option-select";
import { SettingRow } from "./setting-row";
import { SettingsSection } from "./settings-section";

export function DataSection() {
  const { t } = useTranslation("settings");
  const id = useId();
  const historySize = useSettings((s) => s.queryHistorySize);
  const timeLimit = useSettings((s) => s.queryTimeLimitSeconds);
  const update = useSettings((s) => s.update);
  const clearHistory = useQueryHistory((s) => s.clearAll);
  const scansKept = useSettings((s) => s.diagramScansKept);
  const clearScans = useClearDiagramScans();
  const tools = useQuery({
    queryKey: ["database-tools-status"],
    queryFn: () => call(commands.databaseToolsStatus()),
  });
  return (
    <>
      <SettingsSection title={t("data.title")} description={t("data.description")}>
        <SettingRow
          id={`${id}-time-limit`}
          label={t("data.timeLimit")}
          description={t("data.timeLimitHint")}
        >
          <OptionSelect
            id={`${id}-time-limit`}
            value={timeLimit}
            options={[0, 15, 30, 60, 300, 900] as const}
            onChange={(value) => update({ queryTimeLimitSeconds: value })}
            format={(value) =>
              value === 0 ? t("data.noTimeLimit") : t("data.seconds", { count: value })
            }
          />
        </SettingRow>
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
      <SettingsSection title={t("diagrams.title")} description={t("diagrams.description")}>
        <SettingRow
          id={`${id}-diagram-scans`}
          label={t("diagrams.kept")}
          description={t("diagrams.keptHint")}
        >
          <OptionSelect
            id={`${id}-diagram-scans`}
            value={scansKept}
            options={[1, 5, 10, 20, 50] as const}
            onChange={(value) => update({ diagramScansKept: value })}
            format={(value) => t("diagrams.scans", { count: value })}
          />
        </SettingRow>
        <SettingRow label={t("diagrams.clear")} description={t("diagrams.clearHint")}>
          <Button
            variant="outline"
            size="sm"
            disabled={clearScans.isPending}
            onClick={() =>
              clearScans.mutate(undefined, {
                onSuccess: (count) => toast.success(t("diagrams.cleared", { count })),
                onError: (error) => toast.error(errorMessage(error)),
              })
            }
          >
            {t("diagrams.delete")}
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
              <Badge variant="warning">{t("tools.missing")}</Badge>
            ))}
        </SettingRow>
      </SettingsSection>
    </>
  );
}
