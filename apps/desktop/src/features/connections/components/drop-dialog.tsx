import type { CollectionKind, ConnectionInfo } from "@odin-db/bindings";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@odin-db/ui/components/alert-dialog";
import { Button } from "@odin-db/ui/components/button";
import { Input } from "@odin-db/ui/components/input";
import { Label } from "@odin-db/ui/components/label";
import { type FormEvent, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { InlineError } from "@/components/inline-error";
import { useTabs } from "@/features/workspace";
import { errorMessage } from "@/lib/ipc";
import { useDropCollection, useDropDatabase } from "../api/mutations";
import { useFavorites } from "../store/favorites-store";

type DropTarget =
  | { kind: "database"; database: string }
  | { kind: "collection"; database: string; collection: string; collectionKind: CollectionKind };

interface DropDialogProps {
  connection: ConnectionInfo;
  target: DropTarget;
  onClose: () => void;
}

/** Drops a database or collection after the user types its name (ADR-0017). */
export function DropDialog({ connection, target, onClose }: DropDialogProps) {
  const { t } = useTranslation("connections");
  const id = useId();
  const dropCollection = useDropCollection(connection.id);
  const dropDatabase = useDropDatabase(connection.id);
  const closeCollections = useTabs((s) => s.closeCollections);
  const forgetFavorites = useFavorites((s) => s.forget);
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);

  const name = target.kind === "database" ? target.database : target.collection;
  const namespace = target.kind === "database" ? name : `${target.database}.${target.collection}`;
  const isView = target.kind === "collection" && target.collectionKind === "view";
  const pending = dropCollection.isPending || dropDatabase.isPending;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      if (target.kind === "database") {
        await dropDatabase.mutateAsync(target.database);
        closeCollections(connection.profileId, target.database);
        forgetFavorites(connection.profileId, target.database);
      } else {
        await dropCollection.mutateAsync({
          database: target.database,
          collection: target.collection,
        });
        closeCollections(connection.profileId, target.database, target.collection);
        forgetFavorites(connection.profileId, target.database, target.collection);
      }
    } catch (cause) {
      setError(errorMessage(cause));
      return;
    }
    toast.success(t("catalog.drop.dropped", { name: namespace }));
    onClose();
  }

  const title =
    target.kind === "database"
      ? t("catalog.drop.databaseTitle", { name })
      : isView
        ? t("catalog.drop.viewTitle", { name })
        : t("catalog.drop.collectionTitle", { name });
  const body =
    target.kind === "database"
      ? t("catalog.drop.databaseBody", { name })
      : isView
        ? t("catalog.drop.viewBody", { namespace })
        : t("catalog.drop.collectionBody", { namespace });

  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-4">
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>{body}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-confirm`} className="text-destructive text-xs">
              {t("catalog.drop.confirmLabel", { name })}
            </Label>
            <Input
              id={`${id}-confirm`}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
            />
          </div>
          {error && <InlineError>{error}</InlineError>}
          <AlertDialogFooter>
            <AlertDialogCancel type="button">
              {t("actions.cancel", { ns: "common" })}
            </AlertDialogCancel>
            <Button type="submit" variant="destructive" disabled={pending || confirmation !== name}>
              {t("catalog.drop.submit")}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
