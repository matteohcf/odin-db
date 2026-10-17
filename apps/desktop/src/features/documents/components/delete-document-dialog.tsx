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
import { useTranslation } from "react-i18next";
import { describeEJson, type JsonObject } from "@/lib/ejson-display";

interface DeleteDocumentDialogProps {
  document: JsonObject | undefined;
  collection: string;
  pending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function DeleteDocumentDialog({
  document,
  collection,
  pending,
  onConfirm,
  onClose,
}: DeleteDocumentDialogProps) {
  const { t } = useTranslation("documents");
  const id = document?._id === undefined ? "" : describeEJson(document._id).text;

  return (
    <AlertDialog open={document !== undefined} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("delete.title")}</AlertDialogTitle>
          <AlertDialogDescription className="break-words">
            {t("delete.body", { id, collection })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("actions.cancel", { ns: "common" })}</AlertDialogCancel>
          {/* A plain button: the dialog must stay open until the delete succeeds. */}
          <Button variant="destructive" onClick={onConfirm} disabled={pending}>
            {t("delete.confirm")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
