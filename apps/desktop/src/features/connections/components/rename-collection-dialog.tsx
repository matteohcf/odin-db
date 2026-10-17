import type { ConnectionInfo } from "@odin-db/bindings";
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
import { CircleAlert } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useTabs } from "@/features/workspace";
import { errorMessage } from "@/lib/ipc";
import { useRenameCollection } from "../api/mutations";

interface RenameCollectionDialogProps {
  connection: ConnectionInfo;
  database: string;
  collection: string;
  onClose: () => void;
}

export function RenameCollectionDialog({
  connection,
  database,
  collection,
  onClose,
}: RenameCollectionDialogProps) {
  const { t } = useTranslation("connections");
  const id = useId();
  const rename = useRenameCollection(connection.id);
  const renameTabs = useTabs((s) => s.renameCollection);
  const [name, setName] = useState(collection);
  const [error, setError] = useState<string | null>(null);
  const newName = name.trim();

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await rename.mutateAsync({ namespace: { database, collection }, newName });
    } catch (cause) {
      setError(errorMessage(cause));
      return;
    }
    renameTabs(connection.profileId, database, collection, newName);
    toast.success(t("catalog.rename.renamed", { name: newName }));
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t("catalog.rename.title", { name: collection })}</DialogTitle>
            <DialogDescription>{t("catalog.rename.description")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-name`}>{t("catalog.rename.name")}</Label>
            <Input
              id={`${id}-name`}
              value={name}
              onChange={(event) => setName(event.target.value)}
              onFocus={(event) => event.target.select()}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
            />
          </div>
          {error && (
            <p
              role="alert"
              className="flex items-start gap-1.5 text-destructive text-xs selectable"
            >
              <CircleAlert className="mt-px size-3.5 shrink-0" />
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("actions.cancel", { ns: "common" })}
            </Button>
            <Button
              type="submit"
              disabled={rename.isPending || newName === "" || newName === collection}
            >
              {t("catalog.rename.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
