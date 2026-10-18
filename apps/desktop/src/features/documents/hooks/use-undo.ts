import { type ConnectionId, commands, type JsonValue, type Namespace } from "@odin-db/bindings";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { JsonObject } from "@/lib/ejson-display";
import { call, errorMessage } from "@/lib/ipc";
import { useSetDocumentField } from "../api/mutations";

/** Confirmations that can take a change back: deleted documents, edited fields. */
export function useUndo(connectionId: ConnectionId, namespace: Namespace, refresh: () => void) {
  const { t } = useTranslation("documents");
  const setField = useSetDocumentField();

  /** Puts deleted documents back exactly as they were, `_id` and types included. */
  async function restore(rows: JsonObject[]) {
    try {
      for (const row of rows) {
        await call(commands.insertDocument(connectionId, namespace, row));
      }
    } catch (error) {
      toast.error(t("undo.failed", { message: errorMessage(error) }));
      refresh();
      return;
    }
    toast.success(t("undo.restored", { count: rows.length }));
    refresh();
  }

  function offerUndo(rows: JsonObject[], message: string) {
    toast.success(message, {
      duration: 10_000,
      action: { label: t("undo.action"), onClick: () => void restore(rows) },
    });
  }

  /** Confirms a field change with an Undo that writes the previous value back. */
  function offerFieldUndo(
    id: JsonValue,
    field: string,
    previous: JsonValue | undefined,
    message: string,
  ) {
    toast.success(message, {
      duration: 10_000,
      action: {
        label: t("undo.action"),
        onClick: () =>
          void setField
            .mutateAsync({ connectionId, namespace, id, field, value: previous })
            .then(() => {
              toast.success(t("field.restored", { field }));
              refresh();
            })
            .catch((error: unknown) => toast.error(errorMessage(error))),
      },
    });
  }

  return { offerUndo, offerFieldUndo };
}
