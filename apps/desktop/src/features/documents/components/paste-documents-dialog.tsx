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
import { Progress } from "@odin-db/ui/components/progress";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { call, errorMessage } from "@/lib/ipc";
import { toShellSyntax } from "@/lib/shell-syntax";

interface PasteDocumentsDialogProps {
  connectionId: ConnectionId;
  namespace: Namespace;
  documents: EJsonDocument[];
  onDone: () => void;
  onClose: () => void;
}

/** Confirms and inserts documents pasted from the clipboard. */
export function PasteDocumentsDialog({
  connectionId,
  namespace,
  documents,
  onDone,
  onClose,
}: PasteDocumentsDialogProps) {
  const { t } = useTranslation("documents");
  const [inserted, setInserted] = useState<number | null>(null);

  async function insert() {
    let done = 0;
    const failures: string[] = [];
    setInserted(0);
    for (const document of documents) {
      try {
        await call(commands.insertDocument(connectionId, namespace, document));
        done += 1;
      } catch (error) {
        failures.push(errorMessage(error));
      }
      setInserted(done + failures.length);
    }
    if (failures.length === 0) toast.success(t("paste.done", { count: done }));
    else
      toast.warning(t("paste.partial", { count: done, failed: failures.length }), {
        description: failures[0],
      });
    onDone();
    onClose();
  }

  const busy = inserted !== null;
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("paste.title", { count: documents.length })}</DialogTitle>
          <DialogDescription>
            {t("paste.description", { namespace: `${namespace.database}.${namespace.collection}` })}
          </DialogDescription>
        </DialogHeader>
        <pre className="max-h-60 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs selectable">
          {documents[0] ? toShellSyntax(documents[0]) : ""}
          {documents.length > 1 && `\n\n${t("paste.more", { count: documents.length - 1 })}`}
        </pre>
        {busy && <Progress value={((inserted ?? 0) / documents.length) * 100} />}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t("actions.cancel", { ns: "common" })}
          </Button>
          <Button onClick={() => void insert()} disabled={busy}>
            {t("paste.insert", { count: documents.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
