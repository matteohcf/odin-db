import { describe, expect, it } from "vitest";
import { withoutAppShortcuts } from "./editor-keybindings";
import { SHORTCUTS, type ShortcutId } from "./shortcuts";

const defaults = (id: ShortcutId) => SHORTCUTS[id];

describe("withoutAppShortcuts", () => {
  it("drops the editor keys that app shortcuts use, keeps the rest", () => {
    const bindings = [
      { key: "Mod-i" },
      { key: "Mod-/" },
      { key: "Shift-Mod-k" },
      { key: "Mod-[" },
      { key: "Alt-ArrowUp" },
    ];
    expect(withoutAppShortcuts(bindings, true, defaults).map((b) => b.key)).toEqual([
      "Shift-Mod-k",
      "Mod-[",
      "Alt-ArrowUp",
    ]);
  });

  it("follows the user's shortcuts", () => {
    const moved = (id: ShortcutId) => (id === "askAi" ? { key: "[", mod: true } : SHORTCUTS[id]);
    expect(withoutAppShortcuts([{ key: "Mod-i" }, { key: "Mod-[" }], true, moved)).toEqual([
      { key: "Mod-i" },
    ]);
  });

  it("reads Ctrl as Mod off macOS", () => {
    expect(withoutAppShortcuts([{ key: "Ctrl-k" }], false, defaults)).toEqual([]);
    expect(withoutAppShortcuts([{ key: "Ctrl-k" }], true, defaults)).toEqual([{ key: "Ctrl-k" }]);
  });
});
