import type { EJsonDocument } from "@odin-db/bindings";
import { Button } from "@odin-db/ui/components/button";
import { Kbd } from "@odin-db/ui/components/kbd";
import { Code2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { JsonObject } from "@/lib/ejson-display";
import { parseShellDocument } from "@/lib/shell-syntax";
import { EDIT_SHORTCUTS, label, matches } from "@/lib/shortcuts";
import {
  checkDraft,
  type DraftField,
  draftToShell,
  emptyField,
  insertField,
  toDraft,
  updateField,
} from "../lib/document-draft";
import { type DraftFieldHandlers, DraftFieldRow } from "./draft-field-row";

/** Edits a document inside its card, like Compass: names, values, added and removed fields. */
export function DocumentCardEditor({
  row,
  onSave,
  onCancel,
  onOpenEditor,
}: {
  row: JsonObject;
  onSave: (document: EJsonDocument) => Promise<void>;
  onCancel: () => void;
  /** Switches to the full code editor, e.g. for bulk changes. */
  onOpenEditor: () => void;
}) {
  const { t } = useTranslation("results");
  const [draft, setDraft] = useState(() => toDraft(row));
  const [problems, setProblems] = useState<ReadonlyMap<string, string>>(new Map());
  const [saving, setSaving] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const container = useRef<HTMLDivElement>(null);

  // A new field gets the cursor in its name, or its value inside an array.
  useEffect(() => {
    if (!focusId) return;
    container.current
      ?.querySelector<HTMLInputElement>(`[data-field-id="${focusId}"] input`)
      ?.focus();
    setFocusId(null);
  }, [focusId]);

  const add = (place: Parameters<typeof insertField>[2]) => {
    const field = emptyField();
    setDraft((current) => insertField(current, field, place));
    setFocusId(field.id);
  };
  const handlers: DraftFieldHandlers = {
    problems,
    onChange: (id, change) => {
      setDraft((current) => updateField(current, id, change));
      setProblems((current) => {
        if (!current.has(id)) return current;
        const next = new Map(current);
        next.delete(id);
        return next;
      });
    },
    onAddAfter: (afterId) => add({ afterId }),
    onAddInside: (parentId) => add({ parentId }),
  };

  async function save() {
    const found = await checkDraft(draft);
    const messages = new Map(
      found.map(({ id, message }) => [
        id,
        message === "name"
          ? t("edit.nameRequired")
          : message === "duplicate"
            ? t("edit.duplicate")
            : message,
      ]),
    );
    setProblems(messages);
    if (messages.size > 0) return;
    setSaving(true);
    try {
      await onSave(await parseShellDocument(draftToShell(draft)));
    } catch {
      // The caller reported the error; the edits stay so they can be fixed.
    } finally {
      setSaving(false);
    }
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Cmd+Enter and Escape apply to the focused field inside.
    <div
      ref={container}
      onKeyDown={(event) => {
        if (matches(EDIT_SHORTCUTS.submit, event)) {
          event.preventDefault();
          void save();
        } else if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
      }}
      onMouseDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <ul className="font-mono text-xs leading-5">
        {draft.map((field: DraftField, index) => (
          <DraftFieldRow
            key={field.id}
            field={field}
            depth={0}
            inArray={false}
            index={index}
            locked={field.key === "_id" && row._id !== undefined}
            handlers={handlers}
          />
        ))}
      </ul>
      <div className="-mx-2 -mb-1.5 mt-2 flex items-center gap-2 rounded-b-md border-t bg-muted/40 px-2 py-1.5">
        <p className="min-w-0 flex-1 truncate text-xs" role={problems.size ? "alert" : undefined}>
          {problems.size > 0 ? (
            <span className="text-destructive">{t("edit.problems", { count: problems.size })}</span>
          ) : (
            <span className="text-muted-foreground">{t("edit.editing")}</span>
          )}
        </p>
        <Button variant="ghost" size="sm" onClick={onOpenEditor}>
          <Code2 />
          {t("edit.openEditor")}
        </Button>
        <Button variant="outline" size="sm" onClick={onCancel}>
          {t("actions.cancel", { ns: "common" })}
        </Button>
        <Button size="sm" disabled={saving} onClick={() => void save()}>
          {t("edit.update")}
          <Kbd className="bg-primary-foreground/15 text-primary-foreground">
            {label(EDIT_SHORTCUTS.submit)}
          </Kbd>
        </Button>
      </div>
    </div>
  );
}
