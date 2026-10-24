import type { ConnectionInfo, EJsonDocument, Namespace } from "@odin-db/bindings";
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
import { type FormEvent, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { FormField } from "@/components/form-field";
import { useTabs } from "@/features/workspace";
import { errorMessage } from "@/lib/ipc";
import { useCreateCollection } from "../api/mutations";

interface CreateViewDialogProps {
  connection: ConnectionInfo;
  /** The collection or view the pipeline reads. */
  source: Namespace;
  pipeline: EJsonDocument[];
  onClose: () => void;
}

/** Saves an aggregation pipeline as a view beside its source, then opens it. */
export function CreateViewDialog({ connection, source, pipeline, onClose }: CreateViewDialogProps) {
  const { t } = useTranslation("connections");
  const id = useId();
  const create = useCreateCollection(connection.id);
  const openCollection = useTabs((s) => s.openCollection);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | undefined>();

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const namespace = { database: source.database, collection: name.trim() };
    try {
      await create.mutateAsync({
        namespace,
        options: { kind: { kind: "view", source: source.collection, pipeline }, collation: null },
      });
    } catch (cause) {
      setError(errorMessage(cause));
      return;
    }
    toast.success(t("catalog.createView.created", { name: namespace.collection }));
    openCollection({ profileId: connection.profileId, ...namespace, collectionKind: "view" });
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t("catalog.createView.title")}</DialogTitle>
            <DialogDescription>
              {t("catalog.createView.description", {
                count: pipeline.length,
                source: source.collection,
              })}
            </DialogDescription>
          </DialogHeader>
          <FormField id={`${id}-name`} label={t("catalog.createView.name")} error={error}>
            <Input
              id={`${id}-name`}
              value={name}
              onChange={(event) => setName(event.target.value)}
              aria-invalid={error !== undefined}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
            />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("actions.cancel", { ns: "common" })}
            </Button>
            <Button type="submit" disabled={create.isPending || name.trim() === ""}>
              {t("catalog.createView.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
