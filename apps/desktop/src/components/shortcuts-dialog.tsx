import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@odin-db/ui/components/dialog";
import { Kbd } from "@odin-db/ui/components/kbd";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useShortcutsDialog } from "@/hooks/use-shortcuts-dialog";

const isMac = navigator.userAgent.includes("Mac");
const mod = isMac ? "⌘" : "Ctrl";

const GROUPS = [
  {
    id: "general",
    shortcuts: [
      ["palette", [`${mod} K`]],
      ["shortcuts", [`${mod} /`]],
      ["closeTab", [`${mod} W`]],
    ],
  },
  {
    id: "query",
    shortcuts: [
      ["run", ["↵", `${mod} ↵`]],
      ["suggest", ["Ctrl Space"]],
      ["accept", ["Tab", "↵"]],
      ["dismiss", ["Esc"]],
    ],
  },
  {
    id: "results",
    shortcuts: [
      ["move", ["↑", "↓"]],
      ["jump", ["Home", "End"]],
      ["open", ["↵"]],
      ["delete", [isMac ? "⌫" : "Delete"]],
    ],
  },
] as const;

/** Every keyboard shortcut in one place, toggled with Mod+/. */
export function ShortcutsDialog() {
  const { t } = useTranslation("common");
  const open = useShortcutsDialog((s) => s.open);
  const setOpen = useShortcutsDialog((s) => s.setOpen);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "/") {
        event.preventDefault();
        setOpen(!useShortcutsDialog.getState().open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setOpen]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("shortcuts.title")}</DialogTitle>
          <DialogDescription>{t("shortcuts.description")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {GROUPS.map((group) => (
            <section key={group.id} className="flex flex-col gap-1.5">
              <h3 className="font-medium text-muted-foreground text-xs">
                {t(`shortcuts.groups.${group.id}`)}
              </h3>
              <dl className="flex flex-col gap-1">
                {group.shortcuts.map(([action, keys]) => (
                  <div key={action} className="flex items-center justify-between gap-4 text-sm">
                    <dt>{t(`shortcuts.actions.${action}`)}</dt>
                    <dd className="flex items-center gap-1">
                      {keys.map((key) => (
                        <Kbd key={key}>{key}</Kbd>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
