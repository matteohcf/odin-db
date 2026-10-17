import type { ConnectionProfile } from "@odin-db/bindings";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@odin-db/ui/components/alert-dialog";
import { buttonVariants } from "@odin-db/ui/components/button";
import { useTranslation } from "react-i18next";
import { useDeleteProfile } from "../api/mutations";

export function DeleteProfileDialog({
  profile,
  onClose,
}: {
  profile: ConnectionProfile | undefined;
  onClose: () => void;
}) {
  const { t } = useTranslation("connections");
  const remove = useDeleteProfile();

  return (
    <AlertDialog open={profile !== undefined} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("delete.title", { name: profile?.name ?? "" })}</AlertDialogTitle>
          <AlertDialogDescription>{t("delete.body")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("actions.cancel", { ns: "common" })}</AlertDialogCancel>
          <AlertDialogAction
            className={buttonVariants({ variant: "destructive" })}
            onClick={() => profile && remove.mutate(profile.id, { onSuccess: onClose })}
          >
            {t("delete.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
