import { Input } from "@odin-db/ui/components/input";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { useOllamaModels } from "@/features/ai";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { errorMessage } from "@/lib/ipc";
import { useSettings } from "@/lib/settings";
import { OptionSelect } from "./option-select";
import { SettingRow } from "./setting-row";

/** The Ollama address and which of its models to use. */
export function OllamaRows() {
  const { t } = useTranslation("settings");
  const id = useId();
  const url = useSettings((s) => s.aiOllamaUrl);
  const model = useSettings((s) => s.aiOllamaModel);
  const update = useSettings((s) => s.update);
  const models = useOllamaModels(useDebouncedValue(url, 400), true);
  const names = models.data?.map((entry) => entry.name) ?? [];
  const status = models.isFetching
    ? t("ai.ollama.checking")
    : models.error
      ? t("ai.ollama.unreachable", { message: errorMessage(models.error) })
      : models.data
        ? t("ai.ollama.found", { count: names.length })
        : undefined;

  return (
    <>
      <SettingRow id={`${id}-url`} label={t("ai.ollama.url")} description={status}>
        <Input
          id={`${id}-url`}
          value={url}
          onChange={(event) => update({ aiOllamaUrl: event.target.value })}
          spellCheck={false}
          className="h-8 w-60 font-mono text-xs"
        />
      </SettingRow>
      <SettingRow
        id={`${id}-model`}
        label={t("ai.ollama.model")}
        description={names.length === 0 ? t("ai.ollama.pullHint") : undefined}
      >
        {names.length > 0 && (
          <OptionSelect
            id={`${id}-model`}
            value={names.includes(model) ? model : ""}
            options={names}
            onChange={(value) => update({ aiOllamaModel: value })}
            className="w-60"
          />
        )}
      </SettingRow>
    </>
  );
}
