import type { ConnectionId, ConvertTarget, EJsonDocument, Namespace } from "@odin-db/bindings";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@odin-db/ui/components/select";
import { CircleAlert } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { FormField } from "@/components/form-field";
import { isJsonObject } from "@/lib/ejson-display";
import { errorMessage } from "@/lib/ipc";
import { useChangeField } from "../api/mutations";
import { useMatchingCount } from "../api/queries";
import { ConfirmCollectionName } from "./confirm-collection-name";
import { MatchingDocuments } from "./matching-documents";

export type FieldChangeKind = "rename" | "convert" | "remove";

const TARGETS: readonly ConvertTarget[] = [
  "string",
  "int",
  "long",
  "double",
  "decimal",
  "bool",
  "date",
  "objectId",
];

interface ChangeFieldDialogProps {
  kind: FieldChangeKind;
  field: string;
  connectionId: ConnectionId;
  namespace: Namespace;
  /** The query bar's filter: matching documents that have the field change. */
  filter: EJsonDocument;
  onDone: () => void;
  /** Confirms a change that can be undone, with the documents as they were. */
  onUndoable?: ((originals: EJsonDocument[], message: string) => void) | undefined;
  onClose: () => void;
}

/** Renames, converts or removes one field in every document matching the filter. */
export function ChangeFieldDialog({
  kind,
  field,
  connectionId,
  namespace,
  filter,
  onDone,
  onUndoable,
  onClose,
}: ChangeFieldDialogProps) {
  const { t } = useTranslation("documents");
  const id = useId();
  const [to, setTo] = useState(field);
  const [target, setTarget] = useState<ConvertTarget>("string");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const change = useChangeField();
  const count = useMatchingCount(connectionId, namespace, filter);
  const matching = count.data ?? null;
  const matchAll = isJsonObject(filter) && Object.keys(filter).length === 0;
  const needsConfirmation = matchAll && (matching ?? 0) > 0;
  const ready =
    matching !== null &&
    matching > 0 &&
    (kind !== "rename" || (to.trim() !== "" && to.trim() !== field)) &&
    (!needsConfirmation || confirmation === namespace.collection);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setError(null);
    try {
      const result = await change.mutateAsync({
        connectionId,
        namespace,
        filter,
        field,
        change:
          kind === "rename"
            ? { kind, to: to.trim() }
            : kind === "convert"
              ? { kind, to: target }
              : { kind },
      });
      const changed = result.modified ?? 0;
      const kept = (result.matched ?? 0) - changed;
      const message =
        kind === "convert" && kept > 0
          ? t("fieldChange.convertedSome", { count: changed, kept })
          : t(`fieldChange.${kind}.done`, { count: changed, field, to: to.trim() });
      if (result.originals && changed > 0 && onUndoable) onUndoable(result.originals, message);
      else if (kind === "convert" && kept > 0) toast.warning(message);
      else toast.success(message);
    } catch (cause) {
      setError(errorMessage(cause));
      return;
    }
    onDone();
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !change.isPending && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t(`fieldChange.${kind}.title`, { field })}</DialogTitle>
            <DialogDescription>{t(`fieldChange.${kind}.description`, { field })}</DialogDescription>
          </DialogHeader>

          <MatchingDocuments filter={filter} count={count} undoable />

          {kind === "rename" && (
            <FormField
              id={`${id}-to`}
              label={t("fieldChange.rename.to")}
              hint={t("fieldChange.rename.hint")}
            >
              <Input
                id={`${id}-to`}
                value={to}
                onChange={(event) => setTo(event.target.value)}
                autoFocus
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
              />
            </FormField>
          )}
          {kind === "convert" && (
            <FormField
              id={`${id}-type`}
              label={t("fieldChange.convert.to")}
              hint={t("fieldChange.convert.hint")}
            >
              <Select value={target} onValueChange={(value) => setTarget(value as ConvertTarget)}>
                <SelectTrigger id={`${id}-type`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TARGETS.map((type) => (
                    <SelectItem key={type} value={type}>
                      {t(`fieldChange.types.${type}` as const)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          )}

          {needsConfirmation && (
            <ConfirmCollectionName
              namespace={namespace}
              count={matching ?? 0}
              value={confirmation}
              onChange={setConfirmation}
            />
          )}

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
            <Button type="button" variant="ghost" onClick={onClose} disabled={change.isPending}>
              {t("actions.cancel", { ns: "common" })}
            </Button>
            <Button
              type="submit"
              variant={kind === "remove" ? "destructive" : "default"}
              disabled={!ready || change.isPending}
            >
              {t(`fieldChange.${kind}.submit`)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
