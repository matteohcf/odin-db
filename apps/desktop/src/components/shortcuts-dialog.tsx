import { Button } from "@odin-db/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@odin-db/ui/components/dialog";
import { Keyboard } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useShortcut } from "@/hooks/use-shortcut";
import { useShortcutsDialog } from "@/hooks/use-shortcuts-dialog";
import { ShortcutsList } from "./shortcuts-list";

/** Every keyboard shortcut in one place, toggled with Mod+/; `onCustomize` opens the settings. */
export function ShortcutsDialog({ onCustomize }: { onCustomize: () => void }) {
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
        <div className="-mr-2 max-h-[60vh] overflow-y-auto pr-2">
          <ShortcutsList />
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setOpen(false);
              onCustomize();
            }}
          >
            <Keyboard />
            {t("shortcuts.customize")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
