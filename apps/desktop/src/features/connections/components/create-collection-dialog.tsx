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
import { cn } from "@odin-db/ui/lib/utils";
import { ChevronRight, CircleAlert } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useTabs } from "@/features/workspace";
import { errorMessage } from "@/lib/ipc";
import { useCreateCollection } from "../api/mutations";
import {
  type CollectionDraft,
  type DraftErrors,
  emptyDraft,
  toCollectionOptions,
} from "../lib/collection-options";
import { CollectionTypeFields } from "./collection-type-fields";

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
  const [showOptions, setShowOptions] = useState(false);
  const [draft, setDraft] = useState<CollectionDraft>(emptyDraft);
  const [draftErrors, setDraftErrors] = useState<DraftErrors>({});
  const newDatabase = database === undefined;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const namespace = { database: databaseName.trim(), collection: collectionName.trim() };
    const parsed = await toCollectionOptions(draft, {
      required: t("catalog.create.required"),
      invalidNumber: t("catalog.create.invalidNumber"),
    });
    if (!parsed.ok) {
      setDraftErrors(parsed.errors);
      setShowOptions(true);
      return;
    }
    setDraftErrors({});
    try {
      await create.mutateAsync({ namespace, options: parsed.options });
    } catch (cause) {
      setError(errorMessage(cause));
      return;
    }
    toast.success(
      t("catalog.create.created", { namespace: `${namespace.database}.${namespace.collection}` }),
    );
    openCollection({
      profileId: connection.profileId,
      ...namespace,
      collectionKind: draft.type === "timeSeries" ? "timeseries" : "collection",
    });
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
          <div className="flex flex-col gap-4">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-expanded={showOptions}
              onClick={() => setShowOptions((value) => !value)}
              className="-ml-2 self-start text-muted-foreground"
            >
              <ChevronRight className={cn("transition-transform", showOptions && "rotate-90")} />
              {t("catalog.create.moreOptions")}
            </Button>
            {showOptions && (
              <CollectionTypeFields
                draft={draft}
                errors={draftErrors}
                onChange={(changes) => {
                  setDraft((current) => ({ ...current, ...changes }));
                  // A field being fixed drops its error; the rest stay until the next try.
                  setDraftErrors((current) =>
                    Object.fromEntries(
                      Object.entries(current).filter(([field]) => !(field in changes)),
                    ),
                  );
                }}
              />
            )}
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
