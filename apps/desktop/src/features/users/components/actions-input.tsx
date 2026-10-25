import { Badge } from "@odin-db/ui/components/badge";
import { X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SuggestInput } from "@/components/suggest-input";
import { PRIVILEGE_ACTIONS } from "../lib/privileges";

/** A privilege's actions as removable chips; Enter, a comma or a suggestion adds one. */
export function ActionsInput({
  actions,
  onChange,
  label,
}: {
  actions: string[];
  onChange: (actions: string[]) => void;
  label: string;
}) {
  const { t } = useTranslation("users");
  const [draft, setDraft] = useState("");
  const add = (text: string) => {
    const added = text
      .split(",")
      .map((action) => action.trim())
      .filter((action) => action && !actions.includes(action));
    if (added.length > 0) onChange([...actions, ...added]);
    setDraft("");
  };
  return (
    // Enter is handled after the input's own, which picks a highlighted suggestion first.
    // biome-ignore lint/a11y/noStaticElementInteractions: the keys come from the input inside.
    <div
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.defaultPrevented && draft.trim()) {
          event.preventDefault();
          add(draft);
        }
      }}
      className="flex flex-wrap items-center gap-1 rounded-md border px-1.5 py-1 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50"
    >
      {actions.map((action) => (
        <Badge key={action} variant="secondary" className="gap-0.5 pr-0.5 font-mono text-[11px]">
          {action}
          <button
            type="button"
            className="rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
            aria-label={t("privileges.removeAction", { action })}
            onClick={() => onChange(actions.filter((a) => a !== action))}
          >
            <X className="size-3" />
          </button>
        </Badge>
      ))}
      <SuggestInput
        aria-label={label}
        suggestions={PRIVILEGE_ACTIONS.filter((action) => !actions.includes(action))}
        mono
        value={draft}
        onValueChange={(value) => (value.endsWith(",") ? add(value) : setDraft(value))}
        onPick={add}
        onKeyDown={(event) => {
          if (event.key === "Backspace" && draft === "" && actions.length > 0) {
            onChange(actions.slice(0, -1));
          }
        }}
        onBlur={() => draft.trim() && add(draft)}
        placeholder={actions.length === 0 ? t("privileges.actionsPlaceholder") : undefined}
        className="h-6 min-w-32 flex-1 border-0 px-1 font-mono text-xs shadow-none focus-visible:ring-0 dark:bg-transparent"
        spellCheck={false}
      />
    </div>
  );
}
