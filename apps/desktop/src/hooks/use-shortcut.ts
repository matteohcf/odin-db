import { useEffect, useRef } from "react";
import { keybinding } from "@/lib/keybindings";
import { matches, type ShortcutId } from "@/lib/shortcuts";

type Handler = () => void;
const handlers = new Map<ShortcutId, Set<{ current: Handler }>>();
let listening = false;

/** One window listener dispatches every registered shortcut. */
function onKeyDown(event: KeyboardEvent) {
  // An editor already handled the key (e.g. CodeMirror's own search).
  if (event.defaultPrevented) return;
  for (const [id, registered] of handlers) {
    // Read now, so a shortcut the user just changed applies at once.
    if (registered.size === 0 || !matches(keybinding(id), event)) continue;
    event.preventDefault();
    // The most recently mounted handler wins, like a stack of focus scopes.
    [...registered].at(-1)?.current();
    return;
  }
}

/** Binds a global shortcut (as the user set it) while the component is mounted. */
export function useShortcut(id: ShortcutId, handler: Handler, enabled = true) {
  const ref = useRef(handler);
  ref.current = handler;

  useEffect(() => {
    if (!enabled) return;
    if (!listening) {
      window.addEventListener("keydown", onKeyDown);
      listening = true;
    }
    const set = handlers.get(id) ?? new Set();
    handlers.set(id, set);
    set.add(ref);
    return () => {
      set.delete(ref);
    };
  }, [id, enabled]);
}
