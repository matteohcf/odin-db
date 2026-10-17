import type { CompletionSource } from "@codemirror/autocomplete";
import { type ConnectionId, commands, type EJsonDocument, type Namespace } from "@odin-db/bindings";
import { Button } from "@odin-db/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@odin-db/ui/components/dialog";
import { Input } from "@odin-db/ui/components/input";
import { Label } from "@odin-db/ui/components/label";
import { useQuery } from "@tanstack/react-query";
import { CircleAlert, Loader2 } from "lucide-react";
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CodeEditor } from "@/components/code-editor";
import { isJsonObject } from "@/lib/ejson-display";
import { call, errorMessage } from "@/lib/ipc";
import { parseShellDocument, toShellSyntax } from "@/lib/shell-syntax";
import { useDeleteDocuments, useUpdateDocuments } from "../api/mutations";

const NEW_UPDATE = "{\n  $set: {\n    \n  }\n}";

interface BulkWriteDialogProps {
  mode: "update" | "delete";
  connectionId: ConnectionId;
  namespace: Namespace;
  /** The query bar's filter: every matching document is written. */
  filter: EJsonDocument;
  completions: CompletionSource;
  onDone: () => void;
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
  onClose,
}: BulkWriteDialogProps) {
  const { t } = useTranslation("documents");
  const id = useId();
  const update = useRef(NEW_UPDATE);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const updateMany = useUpdateDocuments();
  const deleteMany = useDeleteDocuments();
  const pending = updateMany.isPending || deleteMany.isPending;
  const matchAll = isJsonObject(filter) && Object.keys(filter).length === 0;
  const count = useQuery({
    queryKey: ["bulk-count", connectionId, namespace, filter],
    queryFn: () => call(commands.countDocuments(connectionId, namespace, filter)),
    gcTime: 0,
  });
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
        toast.success(
          t("bulk.updated", { count: result.modified ?? 0, matched: result.matched ?? 0 }),
        );
      } else {
        const deleted = await deleteMany.mutateAsync(target);
        toast.success(t("bulk.deleted", { count: deleted ?? 0 }));
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

        <div className="flex flex-col gap-1.5">
          <span className="font-medium text-sm">{t("bulk.filter")}</span>
          <code className="truncate rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs selectable">
            {matchAll ? t("bulk.allDocuments") : toShellSyntax(filter, 0)}
          </code>
          <p
            role="status"
            className="flex items-center gap-1.5 text-muted-foreground text-xs tabular-nums"
          >
            {count.isPending ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                {t("bulk.counting")}
              </>
            ) : count.error ? (
              t("bulk.countFailed", { message: errorMessage(count.error) })
            ) : (
              t("bulk.matching", { count: matching ?? 0 })
            )}
          </p>
        </div>

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
          <div className="flex flex-col gap-1.5 rounded-md border border-destructive/40 bg-destructive/5 p-2.5">
            <Label htmlFor={`${id}-confirm`} className="text-destructive text-xs">
              {t("bulk.confirmAll", { name: namespace.collection, count: matching ?? 0 })}
            </Label>
            <Input
              id={`${id}-confirm`}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="h-8 font-mono text-xs"
            />
          </div>
        )}

        {error && (
          <p role="alert" className="flex items-start gap-1.5 text-destructive text-xs selectable">
            <CircleAlert className="mt-px size-3.5 shrink-0" />
            {error}
          </p>
        )}

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
