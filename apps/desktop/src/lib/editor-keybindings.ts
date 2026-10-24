import { Prec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { keybinding } from "./keybindings";
import { matches } from "./shortcuts";

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
