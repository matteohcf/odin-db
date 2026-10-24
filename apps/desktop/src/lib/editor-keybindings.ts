import { Prec } from "@codemirror/state";
import { EditorView, type KeyBinding } from "@codemirror/view";
import { keybinding, sameShortcut } from "./keybindings";
import { isMac, matches, SHORTCUTS, type Shortcut, type ShortcutId } from "./shortcuts";

/**
 * Runs `run` on the "run / save" shortcut as the user set it. Read at each key press, so a
 * change in settings applies to editors already open.
 */
export function submitOnKeybinding(run: () => void) {
  return Prec.highest(
    EditorView.domEventHandlers({
      keydown: (event) => {
        if (!matches(keybinding("submit"), event)) return false;
        event.preventDefault();
        run();
        return true;
      },
    }),
  );
}

/** What a CodeMirror key name ("Mod-Shift-k") means as a shortcut; `null` for Alt and the like. */
function shortcutOf(name: string, mac: boolean): Shortcut | null {
  // "Mod--" binds the minus key: the last part is the key, even when empty after the split.
  const key = name.endsWith("--") ? "-" : name.split("-").at(-1);
  if (!key) return null;
  const shortcut: Shortcut = { key };
  for (const part of name
    .slice(0, name.length - key.length - 1)
    .split("-")
    .filter(Boolean)) {
    if (part === "Mod") shortcut.mod = true;
    else if (part === "Ctrl" || part === "c") {
      if (mac) shortcut.ctrl = true;
      else shortcut.mod = true;
    } else if ((part === "Cmd" || part === "Meta" || part === "m") && mac) shortcut.mod = true;
    else if (part === "Shift" || part === "s") shortcut.shift = true;
    else return null;
  }
  return shortcut;
}

/**
 * `bindings` without the keys the app's global shortcuts use (as the user set them), so an editor
 * does not swallow them. Read when the editor is created.
 */
export function withoutAppShortcuts(
  bindings: readonly KeyBinding[],
  mac = isMac,
  shortcutOfId: (id: ShortcutId) => Shortcut | null = keybinding,
): KeyBinding[] {
  const taken = (Object.keys(SHORTCUTS) as ShortcutId[]).map(shortcutOfId);
  return bindings.filter((binding) => {
    const name = (mac ? binding.mac : (binding.win ?? binding.linux)) ?? binding.key;
    const shortcut = name ? shortcutOf(name, mac) : null;
    return !shortcut || !taken.some((other) => sameShortcut(other, shortcut));
  });
}
