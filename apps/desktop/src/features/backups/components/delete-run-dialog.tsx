import type { BackupRun } from "@odin-db/bindings";
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
import { Checkbox } from "@odin-db/ui/components/checkbox";
import { Label } from "@odin-db/ui/components/label";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useDeleteRun } from "../api/backups";

export function DeleteRunDialog({ run, onClose }: { run: BackupRun; onClose: () => void }) {
  const { t } = useTranslation("backups");
  const remove = useDeleteRun();
  const [deleteArchive, setDeleteArchive] = useState(run.archiveExists);
  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("run.deleteTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t("run.deleteBody")}</AlertDialogDescription>
        </AlertDialogHeader>
        {run.archiveExists && (
          <div className="flex items-start gap-2">
            <Checkbox
              id="delete-archive"
              checked={deleteArchive}
              onCheckedChange={(checked) => setDeleteArchive(checked === true)}
            />
            <Label
              htmlFor="delete-archive"
              className="flex flex-col items-start gap-0.5 font-normal"
            >
              <span>{t("run.deleteArchive")}</span>
              <span className="break-all font-mono text-muted-foreground text-xs">
                {run.archive}
              </span>
            </Label>
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>{t("actions.cancel", { ns: "common" })}</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={remove.isPending}
            onClick={() =>
              remove.mutate({ id: run.id, deleteArchive }, { onSuccess: () => onClose() })
            }
          >
            {t("run.delete")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
