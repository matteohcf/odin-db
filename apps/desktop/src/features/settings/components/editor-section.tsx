import { useId } from "react";
import { useTranslation } from "react-i18next";
import { SuggestInput } from "@/components/suggest-input";
import { useSettings } from "@/lib/settings";
import { OptionSelect } from "./option-select";
import { SettingRow } from "./setting-row";
import { SettingsSection } from "./settings-section";

const FONT_SIZES = [11, 12, 12.5, 13, 14, 15, 16, 18] as const;
// Suggestions only: any installed font name works.
const MONO_FONTS = [
  "JetBrains Mono",
  "Fira Code",
  "SF Mono",
  "Menlo",
  "Cascadia Code",
  "Consolas",
  "Source Code Pro",
  "Hack",
  "Ubuntu Mono",
] as const;

export function EditorSection() {
  const { t } = useTranslation("settings");
  const id = useId();
  const editorFontSize = useSettings((s) => s.editorFontSize);
  const shellFontSize = useSettings((s) => s.shellFontSize);
  const shellScrollback = useSettings((s) => s.shellScrollback);
  const monoFont = useSettings((s) => s.monoFont);
  const update = useSettings((s) => s.update);
  return (
    <>
      <SettingsSection title={t("editor.title")} description={t("editor.description")}>
        <SettingRow
          id={`${id}-mono-font`}
          label={t("editor.monoFont")}
          description={t("editor.monoFontHint")}
        >
          <SuggestInput
            id={`${id}-mono-font`}
            value={monoFont}
            onValueChange={(monoFont) => update({ monoFont })}
            placeholder="IBM Plex Mono"
            suggestions={MONO_FONTS}
            mono
            spellCheck={false}
            autoComplete="off"
            className="h-8 w-52 font-mono text-xs"
          />
        </SettingRow>
        <SettingRow
          id={`${id}-editor-font`}
          label={t("editor.fontSize")}
          description={t("editor.fontSizeHint")}
        >
          <OptionSelect
            id={`${id}-editor-font`}
            value={editorFontSize}
            options={FONT_SIZES}
            onChange={(value) => update({ editorFontSize: value })}
            format={(value) => `${value} px`}
            className="w-28"
          />
        </SettingRow>
      </SettingsSection>
      <SettingsSection title={t("shell.title")} description={t("shell.description")}>
        <SettingRow id={`${id}-shell-font`} label={t("shell.fontSize")}>
          <OptionSelect
            id={`${id}-shell-font`}
            value={shellFontSize}
            options={FONT_SIZES}
            onChange={(value) => update({ shellFontSize: value })}
            format={(value) => `${value} px`}
            className="w-28"
          />
        </SettingRow>
        <SettingRow
          id={`${id}-scrollback`}
          label={t("shell.scrollback")}
          description={t("shell.scrollbackHint")}
        >
          <OptionSelect
            id={`${id}-scrollback`}
            value={shellScrollback}
            options={[1_000, 5_000, 10_000, 50_000, 100_000] as const}
            onChange={(value) => update({ shellScrollback: value })}
            format={(value) => t("shell.lines", { count: value })}
            className="w-36"
          />
        </SettingRow>
      </SettingsSection>
    </>
  );
}
