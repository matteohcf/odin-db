import { commands, events } from "@odin-db/bindings";
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
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

/** Asks before quitting while operations run; the backend holds the exit until then. */
export function QuitDialog() {
  const { t } = useTranslation("app");
  const [operations, setOperations] = useState<number | null>(null);

  useEffect(() => {
    const unlisten = events.quitRequested.listen(({ payload }) =>
      setOperations(payload.operations),
    );
    return () => void unlisten.then((stop) => stop());
  }, []);

  return (
    <AlertDialog open={operations !== null} onOpenChange={(open) => !open && setOperations(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("quit.title", { count: operations ?? 0 })}</AlertDialogTitle>
          <AlertDialogDescription>{t("quit.description")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("quit.keep")}</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-white hover:bg-destructive/90"
            onClick={() => void commands.confirmQuit()}
          >
            {t("quit.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
