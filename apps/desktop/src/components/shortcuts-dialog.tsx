import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@odin-db/ui/components/dialog";
import { useTranslation } from "react-i18next";
import { useShortcut } from "@/hooks/use-shortcut";
import { useShortcutsDialog } from "@/hooks/use-shortcuts-dialog";
import { ShortcutsList } from "./shortcuts-list";

/** Every keyboard shortcut in one place, toggled with Mod+/. */
export function ShortcutsDialog() {
  const { t } = useTranslation("common");
  const open = useShortcutsDialog((s) => s.open);
  const setOpen = useShortcutsDialog((s) => s.setOpen);

  useShortcut("shortcuts", () => setOpen(!open));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("shortcuts.title")}</DialogTitle>
          <DialogDescription>{t("shortcuts.description")}</DialogDescription>
        </DialogHeader>
        <ShortcutsList />
      </DialogContent>
    </Dialog>
  );
}
