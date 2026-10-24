import { useSettings } from "./settings";
import { EDIT_SHORTCUTS, isMac, SHORTCUTS, type Shortcut } from "./shortcuts";

/** Every shortcut the user can change, with its default (ADR-0050). */
export const DEFAULT_KEYBINDINGS = { ...SHORTCUTS, ...EDIT_SHORTCUTS } as const satisfies Record<
  string,
  Shortcut
>;

export type KeybindingId = keyof typeof DEFAULT_KEYBINDINGS;

/** What the user changed: another shortcut, or `null` for none. Absent means the default. */
export type Keybindings = Partial<Record<KeybindingId, Shortcut | null>>;

/** The settings page's groups. `zoomInPlus` is not listed: it follows `zoomIn`. */
export const KEYBINDING_GROUPS = [
  {
    id: "general",
    ids: ["palette", "shortcuts", "settings", "filterSidebar", "revealInSidebar"],
  },
  {
    id: "tabs",
    ids: [
      "closeTab",
      "nextTab",
      "previousTab",
      "reopenTab",
      "goToTab1",
      "goToTab2",
      "goToTab3",
      "goToTab4",
      "goToTab5",
      "goToTab6",
      "goToTab7",
      "goToTab8",
      "lastTab",
    ],
  },
  { id: "view", ids: ["zoomIn", "zoomOut", "resetZoom"] },
  { id: "query", ids: ["focusFilter", "askAi", "submit", "rerun"] },
  { id: "edit", ids: ["copy", "paste", "duplicate", "selectAll"] },
] as const satisfies readonly { id: string; ids: readonly KeybindingId[] }[];

const LISTED: readonly KeybindingId[] = KEYBINDING_GROUPS.flatMap((group) => group.ids);

/** The shortcut in effect for `id`, or `null` when the user removed it. */
export function resolve(id: KeybindingId, overrides: Keybindings): Shortcut | null {
  // "+" without Shift is an alias of the default zoom-in key, for layouts that have one.
  if (id === "zoomInPlus") return "zoomIn" in overrides ? null : DEFAULT_KEYBINDINGS.zoomInPlus;
  return id in overrides ? (overrides[id] ?? null) : DEFAULT_KEYBINDINGS[id];
}

export function sameShortcut(a: Shortcut | null, b: Shortcut | null): boolean {
  if (!a || !b) return false;
  return (
    a.key.toLowerCase() === b.key.toLowerCase() &&
    Boolean(a.mod) === Boolean(b.mod) &&
    Boolean(a.ctrl) === Boolean(b.ctrl) &&
    Boolean(a.shift) === Boolean(b.shift)
  );
}

/** The other shortcuts already bound to `shortcut`. */
export function conflicts(
  id: KeybindingId,
  shortcut: Shortcut,
  overrides: Keybindings,
): KeybindingId[] {
  const others = LISTED.filter(
    (other) => other !== id && sameShortcut(resolve(other, overrides), shortcut),
  );
  // The "+" alias acts as zoom in, so taking its keys takes them from zoom in.
  const alias = sameShortcut(resolve("zoomInPlus", overrides), shortcut);
  if (alias && id !== "zoomIn" && !others.includes("zoomIn")) others.push("zoomIn");
  return others;
}

export function isChanged(id: KeybindingId, overrides: Keybindings): boolean {
  return id in overrides;
}

const MODIFIER_KEYS = new Set(["Meta", "Control", "Shift", "Alt", "AltGraph", "CapsLock", "Fn"]);
/** Named keys a shortcut may use; other multi-character keys are dead keys or an input method. */
const NAMED_KEYS = new Set([
  "Enter",
  "Tab",
  "Backspace",
  "Delete",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Insert",
]);
/** Text editing and the system's own window keys, which a shortcut must not take over. */
const RESERVED: readonly Shortcut[] = [
  { key: "z", mod: true },
  { key: "z", mod: true, shift: true },
  { key: "y", mod: true },
  { key: "x", mod: true },
  { key: "q", mod: true },
  { key: "h", mod: true },
  { key: "m", mod: true },
];

export type Recorded =
  | { shortcut: Shortcut }
  /**
   * Shortcuts need Cmd/Ctrl (function keys aside); Option/Alt changes the key typed; some keys
   * belong to text editing or the system.
   */
  | { error: "modifier" | "alt" | "reserved" };

/** The shortcut a key press makes, or `null` while only modifiers (or a dead key) are pressed. */
export function fromKeyEvent(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">,
  mac = isMac,
): Recorded | null {
  if (MODIFIER_KEYS.has(event.key)) return null;
  const functionKey = /^F\d{1,2}$/.test(event.key);
  if (event.key.length !== 1 && !functionKey && !NAMED_KEYS.has(event.key)) return null;
  if (event.altKey) return { error: "alt" };
  // Cmd on macOS and Ctrl elsewhere are "mod"; Ctrl on macOS is its own modifier.
  const mod = mac ? event.metaKey : event.ctrlKey;
  const ctrl = mac && event.ctrlKey;
  if ((!mac && event.metaKey) || (!mod && !ctrl && !functionKey)) return { error: "modifier" };
  const shortcut: Shortcut = {
    key: event.key.length === 1 ? event.key.toLowerCase() : event.key,
    ...(mod ? { mod: true } : {}),
    ...(ctrl ? { ctrl: true } : {}),
    ...(event.shiftKey ? { shift: true } : {}),
  };
  if (RESERVED.some((reserved) => sameShortcut(reserved, shortcut))) return { error: "reserved" };
  return { shortcut };
}

/** The shortcut in effect now; read at key-press time by handlers that need no re-render. */
export function keybinding(id: KeybindingId): Shortcut | null {
  return resolve(id, useSettings.getState().keybindings);
}

export function setKeybinding(id: KeybindingId, shortcut: Shortcut | null) {
  // Back to the default is no longer a change.
  if (sameShortcut(shortcut, DEFAULT_KEYBINDINGS[id])) return resetKeybinding(id);
  const { keybindings, update } = useSettings.getState();
  update({ keybindings: { ...keybindings, [id]: shortcut } });
}

export function resetKeybinding(id: KeybindingId) {
  const { keybindings, update } = useSettings.getState();
  const { [id]: _, ...rest } = keybindings;
  update({ keybindings: rest });
}

export function resetKeybindings() {
  useSettings.getState().update({ keybindings: {} });
}
