import type { CompletionSource } from "@codemirror/autocomplete";
import type { EJsonDocument } from "@odin-db/bindings";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@odin-db/ui/components/alert-dialog";
import { Button } from "@odin-db/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@odin-db/ui/components/dialog";
import { cn } from "@odin-db/ui/lib/utils";
import { CircleAlert, CircleCheck, Copy, LayoutTemplate, WandSparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CodeEditor } from "@/components/code-editor";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { isJsonObject } from "@/lib/ejson-display";
import { errorMessage } from "@/lib/ipc";
import { parseShellDocument, toShellSyntax } from "@/lib/shell-syntax";
import { compareDocuments } from "../lib/compare";

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
  /** A new document shaped like the collection's, offered by "Fill from schema". */
  template?: string | undefined;
}

const isMac = navigator.userAgent.includes("Mac");

export function DocumentEditorDialog(props: DocumentEditorDialogProps) {
  // Unsaved edits are confirmed before the dialog closes, whatever closed it.
  const [dirty, setDirty] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const { t } = useTranslation("results");
  const close = () => {
    if (dirty) setConfirming(true);
    else props.onClose();
  };
  return (
    <>
      <Dialog open={props.open} onOpenChange={(next) => !next && close()}>
        <DialogContent className="flex h-[min(80vh,760px)] flex-col gap-4 sm:max-w-3xl">
          {props.open && <DocumentEditor {...props} onClose={close} onDirtyChange={setDirty} />}
        </DialogContent>
      </Dialog>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("editor.discardTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("editor.discardBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("editor.keepEditing")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                setDirty(false);
                props.onClose();
              }}
            >
              {t("editor.discard")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

type Validation =
  | { status: "pending" }
  | { status: "valid"; changed?: readonly string[] }
  | { status: "invalid"; message: string };

function DocumentEditor({
  mode,
  namespace,
  initialText,
  onSave,
  onClose,
  onDirtyChange,
  completions,
  template,
}: DocumentEditorDialogProps & { onDirtyChange: (dirty: boolean) => void }) {
  const { t } = useTranslation("results");
  const [text, setText] = useState(initialText);
  // Remounts the editor when its content is replaced, e.g. by Format.
  const [editor, setEditor] = useState({ key: 0, text: initialText });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [validation, setValidation] = useState<Validation>({ status: "valid" });
  const readOnly = mode === "view";
  const settled = useDebouncedValue(text, 300);

  useEffect(() => {
    onDirtyChange(!readOnly && text !== initialText);
  }, [text, initialText, readOnly, onDirtyChange]);

  // What an edit changes, so a save never surprises: the original is parsed once.
  const [original] = useState(() =>
    mode === "edit" ? parseShellDocument(initialText).catch(() => null) : Promise.resolve(null),
  );

  useEffect(() => {
    if (readOnly) return;
    let current = true;
    Promise.all([parseShellDocument(settled), original]).then(
      ([parsed, before]) => {
        if (!current) return;
        const changed =
          before && isJsonObject(before) && isJsonObject(parsed)
            ? compareDocuments(before, parsed)
                .filter((row) => row.status !== "same")
                .map((row) => row.path)
            : undefined;
        setValidation(changed ? { status: "valid", changed } : { status: "valid" });
      },
      (cause) => current && setValidation({ status: "invalid", message: errorMessage(cause) }),
    );
    return () => {
      current = false;
    };
  }, [settled, readOnly, original]);

  async function save() {
    if (readOnly || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(await parseShellDocument(text));
      onDirtyChange(false);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  function replace(next: string) {
    setText(next);
    setEditor((current) => ({ key: current.key + 1, text: next }));
  }

  async function format() {
    try {
      replace(toShellSyntax(await parseShellDocument(text)));
    } catch (cause) {
      setError(errorMessage(cause));
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
      <div className="-mb-2 flex items-center gap-1">
        {!readOnly && (
          <Button variant="ghost" size="sm" className="h-7" onClick={() => void format()}>
            <WandSparkles />
            {t("editor.format")}
          </Button>
        )}
        {mode === "insert" && template && (
          <Button variant="ghost" size="sm" className="h-7" onClick={() => replace(template)}>
            <LayoutTemplate />
            {t("editor.fromSchema")}
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-7"
          onClick={() => {
            void navigator.clipboard.writeText(text);
            toast.success(t("row.copied"));
          }}
        >
          <Copy />
          {t("editor.copy")}
        </Button>
        {!readOnly && (
          <span
            role="status"
            className={cn(
              "ml-auto flex min-w-0 items-center gap-1 text-xs",
              validation.status === "invalid" ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {validation.status === "invalid" ? (
              <>
                <CircleAlert className="size-3.5 shrink-0" />
                <span className="truncate" title={validation.message}>
                  {validation.message}
                </span>
              </>
            ) : (
              <>
                <CircleCheck className="size-3.5 shrink-0 text-success" />
                {validation.status === "valid" && validation.changed?.length ? (
                  <span className="truncate" title={validation.changed.join("\n")}>
                    {t("editor.changed", {
                      count: validation.changed.length,
                      fields: validation.changed.slice(0, 3).join(", "),
                    })}
                  </span>
                ) : (
                  t("editor.valid")
                )}
              </>
            )}
          </span>
        )}
      </div>
      <CodeEditor
        key={editor.key}
        initialValue={editor.text}
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
