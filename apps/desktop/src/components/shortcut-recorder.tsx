import { Button } from "@odin-db/ui/components/button";
import { cn } from "@odin-db/ui/lib/utils";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { fromKeyEvent } from "@/lib/keybindings";
import { isMac, type Shortcut } from "@/lib/shortcuts";
import { ShortcutKeys } from "./shortcut-keys";

interface ShortcutRecorderProps {
  value: Shortcut | null;
  onRecord: (shortcut: Shortcut) => void;
  onRemove: () => void;
  /** What the button changes, for screen readers: "Change the shortcut for …". */
  label: string;
}

/**
 * Shows a shortcut; clicked, records the next key combination instead. Esc cancels and Backspace
 * removes the shortcut. While recording, no other shortcut fires.
 */
export function ShortcutRecorder({ value, onRecord, onRemove, label }: ShortcutRecorderProps) {
  const { t } = useTranslation("common");
  const [recording, setRecording] = useState(false);
  const [problem, setProblem] = useState<"modifier" | "alt" | "reserved" | null>(null);
  const callbacks = useRef({ onRecord, onRemove });
  callbacks.current = { onRecord, onRemove };

  useEffect(() => {
    if (!recording) return;
    const stop = () => {
      setRecording(false);
      setProblem(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      // Tab still moves the focus, so the keyboard is never trapped here; Ctrl+Tab is recorded.
      if (event.key === "Tab" && !event.metaKey && !event.ctrlKey && !event.altKey) return stop();
      // First in line (capture), so neither global shortcuts nor a surrounding dialog react.
      event.preventDefault();
      event.stopImmediatePropagation();
      const bare = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
      if (bare && event.key === "Escape") return stop();
      if (bare && (event.key === "Backspace" || event.key === "Delete")) {
        callbacks.current.onRemove();
        return stop();
      }
      const recorded = fromKeyEvent(event);
      if (!recorded) return;
      if ("error" in recorded) return setProblem(recorded.error);
      callbacks.current.onRecord(recorded.shortcut);
      stop();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [recording]);

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="outline"
        size="sm"
        aria-label={label}
        aria-pressed={recording}
        onClick={() => {
          setProblem(null);
          setRecording((value) => !value);
        }}
        onBlur={() => {
          setRecording(false);
          setProblem(null);
        }}
        className={cn(
          "h-7 min-w-24 justify-center px-2 font-normal",
          recording && "border-primary ring-[3px] ring-primary/25",
        )}
      >
        {recording ? (
          <span className="text-muted-foreground text-xs">{t("shortcuts.recorder.press")}</span>
        ) : value ? (
          <ShortcutKeys shortcut={value} />
        ) : (
          <span className="text-muted-foreground text-xs">{t("shortcuts.recorder.none")}</span>
        )}
      </Button>
      {recording && (
        <p
          role="status"
          className={cn("text-[11px]", problem ? "text-destructive" : "text-muted-foreground")}
        >
          {problem === "modifier"
            ? t("shortcuts.recorder.needsModifier", { mod: isMac ? "⌘ / ⌃" : "Ctrl" })
            : problem === "alt"
              ? t("shortcuts.recorder.noAlt")
              : problem === "reserved"
                ? t("shortcuts.recorder.reserved")
                : t("shortcuts.recorder.hint")}
        </p>
      )}
    </div>
  );
}
