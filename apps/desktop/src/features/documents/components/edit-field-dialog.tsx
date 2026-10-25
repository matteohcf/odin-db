import type { JsonValue } from "@odin-db/bindings";
import { Button } from "@odin-db/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@odin-db/ui/components/dialog";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { InlineError } from "@/components/inline-error";
import { QueryEditor } from "@/components/query-editor";
import { QueryFieldFrame } from "@/components/query-field-frame";
import { describeEJson } from "@/lib/ejson-display";
import { errorMessage } from "@/lib/ipc";
import { parseShellDocument, toShellSyntax } from "@/lib/shell-syntax";

interface EditFieldDialogProps {
  field: string;
  /** `undefined` when the document does not have the field yet. */
  value: JsonValue | undefined;
  pending: boolean;
  /** `undefined` removes the field. */
  onSave: (value: JsonValue | undefined) => Promise<void>;
  onClose: () => void;
}

/** Edits one field in mongosh syntax, so its BSON type survives the round trip. */
export function EditFieldDialog({ field, value, pending, onSave, onClose }: EditFieldDialogProps) {
  const { t } = useTranslation("documents");
  const [text, setText] = useState(value === undefined ? "" : toShellSyntax(value, 0));
  const [error, setError] = useState<string | null>(null);

  async function save(remove = false) {
    setError(null);
    try {
      if (remove) {
        await onSave(undefined);
        return;
      }
      // The parser reads documents; a one-field wrapper turns the value into one.
      const parsed = await parseShellDocument(`{ value: ${text.trim() === "" ? '""' : text} }`);
      await onSave((parsed as { value: JsonValue }).value);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-mono">{t("field.title", { field })}</DialogTitle>
          <DialogDescription>{t("field.description")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <QueryFieldFrame label={t("field.value")} invalid={error !== null}>
            <QueryEditor
              value={text}
              onChange={setText}
              onSubmit={() => void save()}
              ariaLabel={t("field.value")}
              invalid={error !== null}
              autoFocus
            />
          </QueryFieldFrame>
          <p className="text-muted-foreground text-xs">
            {value === undefined
              ? t("field.missing", { field })
              : t("field.current", {
                  type: t(`types.${describeEJson(value).kind}`, { ns: "common" }),
                })}
          </p>
          {error && <InlineError>{error}</InlineError>}
        </div>
        <DialogFooter className="sm:justify-between">
          {value !== undefined ? (
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive"
              disabled={pending}
              onClick={() => void save(true)}
            >
              {t("field.remove")}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              {t("actions.cancel", { ns: "common" })}
            </Button>
            <Button disabled={pending} onClick={() => void save()}>
              {t("field.save")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
