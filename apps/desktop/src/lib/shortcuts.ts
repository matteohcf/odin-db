/** Every global keyboard shortcut, in one place (ADR-0024). */
export const SHORTCUTS = {
  palette: { key: "k", mod: true },
  shortcuts: { key: "/", mod: true },
  closeTab: { key: "w", mod: true },
  nextTab: { key: "Tab", ctrl: true },
  previousTab: { key: "Tab", ctrl: true, shift: true },
  settings: { key: ",", mod: true },
  rerun: { key: "r", mod: true },
  focusFilter: { key: "f", mod: true },
  askAi: { key: "i", mod: true },
  // Like Studio 3T's Connection Manager: every saved connection, to pick one.
  connectionManager: { key: "o", mod: true },
  filterSidebar: { key: "f", mod: true, shift: true },
  // Like VS Code's "Reveal in Explorer".
  revealInSidebar: { key: "e", mod: true, shift: true },
  reopenTab: { key: "t", mod: true, shift: true },
  goToTab1: { key: "1", mod: true },
  goToTab2: { key: "2", mod: true },
  goToTab3: { key: "3", mod: true },
  goToTab4: { key: "4", mod: true },
  goToTab5: { key: "5", mod: true },
  goToTab6: { key: "6", mod: true },
  goToTab7: { key: "7", mod: true },
  goToTab8: { key: "8", mod: true },
  // Like browsers: the last tab, however many are open.
  lastTab: { key: "9", mod: true },
  zoomIn: { key: "=", mod: true },
  // Layouts with a dedicated "+" key (Italian, German…) send it without Shift.
  zoomInPlus: { key: "+", mod: true },
  zoomOut: { key: "-", mod: true },
  resetZoom: { key: "0", mod: true },
} as const satisfies Record<string, Shortcut>;

export type ShortcutId = keyof typeof SHORTCUTS;

/**
 * Shortcuts that act on whatever has focus (grid rows, tree nodes, editors), so the focused
 * element handles them with `matches` instead of the global registry.
 */
export const EDIT_SHORTCUTS = {
  copy: { key: "c", mod: true },
  paste: { key: "v", mod: true },
  duplicate: { key: "d", mod: true },
  selectAll: { key: "a", mod: true },
  submit: { key: "Enter", mod: true },
} as const satisfies Record<string, Shortcut>;

export interface Shortcut {
  key: string;
  /** Cmd on macOS, Ctrl elsewhere. */
  mod?: boolean;
  /** Ctrl on every platform. */
  ctrl?: boolean;
  shift?: boolean;
}

export const isMac = typeof navigator !== "undefined" && navigator.userAgent.includes("Mac");

/** Cmd-click on macOS, Ctrl-click elsewhere (on macOS Ctrl-click opens the context menu). */
export function isModClick(event: Pick<MouseEvent, "metaKey" | "ctrlKey">, mac = isMac) {
  return mac ? event.metaKey : event.ctrlKey;
}

type KeyPress = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">;

export function matches(shortcut: Shortcut | null, event: KeyPress, mac = isMac): boolean {
  if (!shortcut) return false;
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

const KEY_LABELS: Record<string, string> = {
  Enter: "↵",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Escape: "Esc",
  Backspace: "⌫",
  " ": "Space",
};

/** How the shortcut reads on this platform, e.g. "⌘ K" or "Ctrl K"; empty for none. */
export function label(shortcut: Shortcut | null, mac = isMac): string {
  if (!shortcut) return "";
  const parts: string[] = [];
  if (shortcut.ctrl) parts.push(mac ? "⌃" : "Ctrl");
  if (shortcut.mod) parts.push(mac ? "⌘" : "Ctrl");
  if (shortcut.shift) parts.push(mac ? "⇧" : "Shift");
  parts.push(
    KEY_LABELS[shortcut.key] ??
      (shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key),
  );
  return parts.join(" ");
}
