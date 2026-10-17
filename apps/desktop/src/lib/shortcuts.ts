/** Every global keyboard shortcut, in one place (ADR-0024). */
export const SHORTCUTS = {
  palette: { key: "k", mod: true },
  shortcuts: { key: "/", mod: true },
  closeTab: { key: "w", mod: true },
  nextTab: { key: "Tab", ctrl: true },
  previousTab: { key: "Tab", ctrl: true, shift: true },
} as const satisfies Record<string, Shortcut>;

export type ShortcutId = keyof typeof SHORTCUTS;

export interface Shortcut {
  key: string;
  /** Cmd on macOS, Ctrl elsewhere. */
  mod?: boolean;
  /** Ctrl on every platform. */
  ctrl?: boolean;
  shift?: boolean;
}

const isMac = typeof navigator !== "undefined" && navigator.userAgent.includes("Mac");

type KeyPress = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">;

export function matches(shortcut: Shortcut, event: KeyPress, mac = isMac): boolean {
  const mod = shortcut.mod === true;
  const wantsMeta = mac && mod;
  const wantsCtrl = shortcut.ctrl === true || (!mac && mod);
  return (
    event.key.toLowerCase() === shortcut.key.toLowerCase() &&
    event.metaKey === wantsMeta &&
    event.ctrlKey === wantsCtrl &&
    event.shiftKey === (shortcut.shift === true) &&
    !event.altKey
  );
}

/** How the shortcut reads on this platform, e.g. "⌘ K" or "Ctrl K". */
export function label(shortcut: Shortcut, mac = isMac): string {
  const parts: string[] = [];
  if (shortcut.ctrl) parts.push(mac ? "⌃" : "Ctrl");
  if (shortcut.mod) parts.push(mac ? "⌘" : "Ctrl");
  if (shortcut.shift) parts.push(mac ? "⇧" : "Shift");
  parts.push(shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key);
  return parts.join(" ");
}
