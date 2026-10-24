import { Button } from "@odin-db/ui/components/button";
import { cn } from "@odin-db/ui/lib/utils";
import { RotateCcw } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useKeybindingName } from "@/hooks/use-keybinding";
import {
  conflicts,
  DEFAULT_KEYBINDINGS,
  isChanged,
  type KeybindingId,
  resetKeybinding,
  resolve,
  setKeybinding,
} from "@/lib/keybindings";
import { useSettings } from "@/lib/settings";
import { label, type Shortcut } from "@/lib/shortcuts";
import { IconAction } from "./icon-action";
import { ShortcutRecorder } from "./shortcut-recorder";

/**
 * One shortcut on the settings page: its name, the keys (click to record new ones) and a reset
 * to the default. Keys already in use ask before moving them here.
 */
export function KeybindingRow({ id, searched }: { id: KeybindingId; searched: boolean }) {
  const { t } = useTranslation("common");
  const name = useKeybindingName();
  const overrides = useSettings((state) => state.keybindings);
  const [pending, setPending] = useState<{ shortcut: Shortcut; others: KeybindingId[] } | null>(
    null,
  );
  const defaultKeys = label(DEFAULT_KEYBINDINGS[id]);

  function record(shortcut: Shortcut) {
    const others = conflicts(id, shortcut, overrides);
    if (others.length > 0) setPending({ shortcut, others });
    else {
      setPending(null);
      setKeybinding(id, shortcut);
    }
  }

  function reassign() {
    if (!pending) return;
    // The others lose the keys rather than silently sharing them.
    for (const other of pending.others) setKeybinding(other, null);
    setKeybinding(id, pending.shortcut);
    setPending(null);
  }

  return (
    // Settings search counts these as matches.
    <div data-setting-row={searched ? "" : undefined} className="flex flex-col gap-1.5 py-1">
      <div className="flex items-start justify-between gap-4">
        <span className="pt-1 text-sm">{name(id)}</span>
        <div className="flex items-start gap-1">
          <ShortcutRecorder
            value={resolve(id, overrides)}
            onRecord={record}
            onRemove={() => {
              setPending(null);
              setKeybinding(id, null);
            }}
            label={t("shortcuts.recorder.change", { action: name(id) })}
          />
          <IconAction
            label={t("shortcuts.recorder.reset", { keys: defaultKeys })}
            onClick={() => {
              setPending(null);
              resetKeybinding(id);
            }}
            // Kept in place when hidden, so the keys column does not shift.
            className={cn("size-7", !isChanged(id, overrides) && "invisible")}
          >
            <RotateCcw />
          </IconAction>
        </div>
      </div>
      {pending && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-md bg-warning/10 py-1 pr-1 pl-2.5 text-xs"
        >
          <span>
            {t("shortcuts.recorder.conflict", {
              keys: label(pending.shortcut),
              actions: pending.others.map((other) => `“${name(other)}”`).join(", "),
            })}
          </span>
          <span className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => setPending(null)}
            >
              {t("shortcuts.recorder.cancel")}
            </Button>
            <Button size="sm" className="h-6 px-2 text-xs" onClick={reassign}>
              {t("shortcuts.recorder.reassign")}
            </Button>
          </span>
        </div>
      )}
    </div>
  );
}
