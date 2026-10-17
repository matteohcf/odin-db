import type { CompletionSource } from "@codemirror/autocomplete";
import type { EJsonDocument } from "@odin-db/bindings";
import { Button } from "@odin-db/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@odin-db/ui/components/dialog";
import { CircleAlert } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CodeEditor } from "@/components/code-editor";
import { errorMessage } from "@/lib/ipc";
import { parseShellDocument } from "@/lib/shell-syntax";

export type EditorMode = "edit" | "view" | "insert";

interface DocumentEditorDialogProps {
  open: boolean;
  mode: EditorMode;
  namespace: string;
  initialText: string;
  /** Resolves when saved; rejects with the error to show. */
  onSave: (document: EJsonDocument) => Promise<void>;
  onClose: () => void;
  /** Field-aware suggestions while writing the document. */
  completions?: CompletionSource | undefined;
}

const isMac = navigator.userAgent.includes("Mac");

export function DocumentEditorDialog(props: DocumentEditorDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={(next) => !next && props.onClose()}>
      <DialogContent className="flex h-[min(80vh,760px)] flex-col gap-4 sm:max-w-3xl">
        <DocumentEditor {...props} />
      </DialogContent>
    </Dialog>
  );
}

function DocumentEditor({
  mode,
  namespace,
  initialText,
  onSave,
  onClose,
  completions,
}: DocumentEditorDialogProps) {
  const { t } = useTranslation("results");
  const [text, setText] = useState(initialText);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const readOnly = mode === "view";

  async function save() {
    if (readOnly || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(await parseShellDocument(text));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  const title = {
    edit: t("editor.editTitle"),
    view: t("editor.viewTitle"),
    insert: t("editor.insertTitle"),
  }[mode];

  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          {readOnly
            ? t("editor.viewDescription", { namespace })
            : t("editor.description", { namespace, shortcut: isMac ? "⌘↵" : "Ctrl+Enter" })}
        </DialogDescription>
      </DialogHeader>
      <CodeEditor
        initialValue={initialText}
        onChange={setText}
        onSubmit={save}
        readOnly={readOnly}
        autoFocus
        ariaLabel={t("editor.label")}
        {...(completions && !readOnly ? { completions } : {})}
        className="flex-1 rounded-md border"
      />
      {error && (
        <p role="alert" className="flex items-start gap-2 text-destructive text-xs selectable">
          <CircleAlert className="mt-px size-3.5 shrink-0" />
          <span className="break-words">{error}</span>
        </p>
      )}
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          {readOnly ? t("actions.close", { ns: "common" }) : t("actions.cancel", { ns: "common" })}
        </Button>
        {!readOnly && (
          <Button onClick={save} disabled={saving}>
            {saving
              ? t("editor.saving")
              : mode === "insert"
                ? t("editor.insert")
                : t("editor.save")}
          </Button>
        )}
      </DialogFooter>
    </>
  );
}
