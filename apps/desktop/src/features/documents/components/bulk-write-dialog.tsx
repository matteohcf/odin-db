import type { CompletionSource } from "@codemirror/autocomplete";
import type { ConnectionId, EJsonDocument, Namespace } from "@odin-db/bindings";
import { Button } from "@odin-db/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@odin-db/ui/components/dialog";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CodeEditor } from "@/components/code-editor";
import { InlineError } from "@/components/inline-error";
import { isJsonObject } from "@/lib/ejson-display";
import { errorMessage } from "@/lib/ipc";
import { parseShellDocument } from "@/lib/shell-syntax";
import { useDeleteDocuments, useUpdateDocuments } from "../api/mutations";
import { useMatchingCount } from "../api/queries";
import { ConfirmCollectionName } from "./confirm-collection-name";
import { MatchingDocuments } from "./matching-documents";

const NEW_UPDATE = "{\n  $set: {\n    \n  }\n}";

interface BulkWriteDialogProps {
  mode: "update" | "delete";
  connectionId: ConnectionId;
  namespace: Namespace;
  /** The query bar's filter: every matching document is written. */
  filter: EJsonDocument;
  completions: CompletionSource;
  onDone: () => void;
  /** Replaces the default "deleted" message, e.g. to offer an undo. */
  onDeleted?: ((count: number) => void) | undefined;
  /** Confirms an update that can be undone, with the documents as they were. */
  onUndoable?: ((originals: EJsonDocument[], message: string) => void) | undefined;
  onClose: () => void;
}

/** Updates or deletes every document matching the current filter, after showing how many. */
export function BulkWriteDialog({
  mode,
  connectionId,
  namespace,
  filter,
  completions,
  onDone,
  onDeleted,
  onUndoable,
  onClose,
}: BulkWriteDialogProps) {
  const { t } = useTranslation("documents");
  const update = useRef(NEW_UPDATE);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const updateMany = useUpdateDocuments();
  const deleteMany = useDeleteDocuments();
  const pending = updateMany.isPending || deleteMany.isPending;
  const matchAll = isJsonObject(filter) && Object.keys(filter).length === 0;
  const count = useMatchingCount(connectionId, namespace, filter);
  const matching = count.data ?? null;
  // Every document of the collection: the name must be typed, as when dropping.
  const needsConfirmation = matchAll && (matching ?? 0) > 0;
  const ready =
    matching !== null &&
    matching > 0 &&
    (!needsConfirmation || confirmation === namespace.collection);

  async function submit() {
    setError(null);
    const target = { connectionId, namespace, filter };
    try {
      if (mode === "update") {
        const parsed = await parseShellDocument(update.current);
        const result = await updateMany.mutateAsync({ ...target, update: parsed });
        const message = t("bulk.updated", {
          count: result.modified ?? 0,
          matched: result.matched ?? 0,
        });
        if (result.originals && onUndoable) onUndoable(result.originals, message);
        else toast.success(message);
      } else {
        const deleted = await deleteMany.mutateAsync(target);
        if (onDeleted) onDeleted(deleted ?? 0);
        else toast.success(t("bulk.deleted", { count: deleted ?? 0 }));
      }
    } catch (cause) {
      setError(errorMessage(cause));
      return;
    }
    onDone();
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {t(mode === "update" ? "bulk.updateTitle" : "bulk.deleteTitle")}
          </DialogTitle>
          <DialogDescription>
            {t(mode === "update" ? "bulk.updateDescription" : "bulk.deleteDescription", {
              namespace: `${namespace.database}.${namespace.collection}`,
            })}
          </DialogDescription>
        </DialogHeader>

        <MatchingDocuments filter={filter} count={count} undoable={mode === "update"} />

        {mode === "update" && (
          <div className="flex flex-col gap-1.5">
            <span className="font-medium text-sm">{t("bulk.update")}</span>
            <CodeEditor
              initialValue={NEW_UPDATE}
              onChange={(value) => {
                update.current = value;
              }}
              onSubmit={() => ready && void submit()}
              completions={completions}
              ariaLabel={t("bulk.update")}
              autoFocus
              className="h-40 rounded-md border"
            />
            <p className="text-muted-foreground text-xs">{t("bulk.updateHint")}</p>
          </div>
        )}

        {needsConfirmation && (
          <ConfirmCollectionName
            namespace={namespace}
            count={matching ?? 0}
            value={confirmation}
            onChange={setConfirmation}
          />
        )}

        {error && <InlineError>{error}</InlineError>}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {t("actions.cancel", { ns: "common" })}
          </Button>
          <Button
            variant={mode === "delete" ? "destructive" : "default"}
            onClick={() => void submit()}
            disabled={!ready || pending}
          >
            {t(mode === "update" ? "bulk.updateSubmit" : "bulk.deleteSubmit", {
              count: matching ?? 0,
            })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
