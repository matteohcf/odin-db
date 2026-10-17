import type { JsonValue } from "@odin-db/bindings";
import { cn } from "@odin-db/ui/lib/utils";
import { type KeyboardEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { errorMessage } from "@/lib/ipc";
import { parseShellDocument, toShellSyntax } from "@/lib/shell-syntax";

interface InlineCellEditorProps {
  value: JsonValue | undefined;
  onSave: (value: JsonValue) => Promise<void>;
  onCancel: () => void;
}

/**
 * A value edited in place, in mongosh syntax so types survive: `"text"`, `42`,
 * `Double(4)`, `ISODate("…")`. Enter or Tab saves; Escape or leaving cancels,
 * so nothing is written to the database by accident.
 */
export function InlineCellEditor({ value, onSave, onCancel }: InlineCellEditorProps) {
  const { t } = useTranslation("results");
  const [text, setText] = useState(() => (value === undefined ? "" : toShellSyntax(value, 0)));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const parsed = await parseShellDocument(`{ value: ${text.trim() || '""'} }`);
      await onSave((parsed as { value: JsonValue }).value);
    } catch (cause) {
      setError(errorMessage(cause));
      setSaving(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // The grid's own shortcuts (arrows, Delete, Enter) must not fire while typing.
    event.stopPropagation();
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      void save();
    } else if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    }
  }

  return (
    <input
      // biome-ignore lint/a11y/noAutofocus: editing starts on a double click, where the user looks.
      autoFocus
      aria-label={t("cell.inline")}
      title={error ?? t("cell.inlineHint")}
      value={text}
      disabled={saving}
      onChange={(event) => {
        setText(event.target.value);
        setError(null);
      }}
      onKeyDown={onKeyDown}
      onBlur={() => !saving && onCancel()}
      onFocus={(event) => event.currentTarget.select()}
      onMouseDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      spellCheck={false}
      className={cn(
        "h-6 w-full rounded-sm border bg-background px-1.5 font-mono text-xs outline-none ring-2",
        error ? "ring-destructive" : "ring-primary/60",
      )}
    />
  );
}
