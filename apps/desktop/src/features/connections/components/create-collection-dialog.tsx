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
import { useCreateCollection } from "../api/mutations";

interface CreateCollectionDialogProps {
  connection: ConnectionInfo;
  /** Fixed when creating a collection in an existing database; asked for otherwise. */
  database?: string;
  onClose: () => void;
}

/** Creates a collection, or a database with its first collection, then opens it. */
export function CreateCollectionDialog({
  connection,
  database,
  onClose,
}: CreateCollectionDialogProps) {
  const { t } = useTranslation("connections");
  const id = useId();
  const create = useCreateCollection(connection.id);
  const openCollection = useTabs((s) => s.openCollection);
  const [databaseName, setDatabaseName] = useState(database ?? "");
  const [collectionName, setCollectionName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const newDatabase = database === undefined;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const namespace = { database: databaseName.trim(), collection: collectionName.trim() };
    try {
      await create.mutateAsync(namespace);
    } catch (cause) {
      setError(errorMessage(cause));
      return;
    }
    toast.success(
      t("catalog.create.created", { namespace: `${namespace.database}.${namespace.collection}` }),
    );
    openCollection({ profileId: connection.profileId, ...namespace, collectionKind: "collection" });
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>
              {newDatabase
                ? t("catalog.create.databaseTitle")
                : t("catalog.create.collectionTitle")}
            </DialogTitle>
            <DialogDescription>
              {newDatabase
                ? t("catalog.create.databaseDescription")
                : t("catalog.create.collectionDescription", { database })}
            </DialogDescription>
          </DialogHeader>
          {newDatabase && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-database`}>{t("catalog.create.database")}</Label>
              <Input
                id={`${id}-database`}
                value={databaseName}
                onChange={(event) => setDatabaseName(event.target.value)}
                autoFocus
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
              />
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-collection`}>{t("catalog.create.collection")}</Label>
            <Input
              id={`${id}-collection`}
              value={collectionName}
              onChange={(event) => setCollectionName(event.target.value)}
              autoFocus={!newDatabase}
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
              disabled={
                create.isPending || collectionName.trim() === "" || databaseName.trim() === ""
              }
            >
              {t("catalog.create.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
