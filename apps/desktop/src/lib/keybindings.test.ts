import { describe, expect, it } from "vitest";
import { conflicts, DEFAULT_KEYBINDINGS, fromKeyEvent, resolve, sameShortcut } from "./keybindings";

const press = (event: {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}) => ({ metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...event });

describe("resolve", () => {
  it("uses the default, the user's shortcut, or none", () => {
    expect(resolve("palette", {})).toBe(DEFAULT_KEYBINDINGS.palette);
    expect(resolve("palette", { palette: { key: "p", mod: true } })).toEqual({
      key: "p",
      mod: true,
    });
    expect(resolve("palette", { palette: null })).toBeNull();
  });

  it("drops the + alias once zoom-in is changed", () => {
    expect(resolve("zoomInPlus", {})).toBe(DEFAULT_KEYBINDINGS.zoomInPlus);
    expect(resolve("zoomInPlus", { zoomIn: { key: "z", mod: true } })).toBeNull();
  });
});

describe("conflicts", () => {
  it("finds the other shortcuts on the same keys", () => {
    expect(conflicts("settings", { key: "K", mod: true }, {})).toEqual(["palette"]);
    expect(conflicts("palette", { key: "k", mod: true }, {})).toEqual([]);
    expect(conflicts("settings", { key: "k", mod: true }, { palette: null })).toEqual([]);
  });

  it("tells modifiers apart", () => {
    expect(sameShortcut({ key: "f", mod: true }, { key: "f", mod: true, shift: true })).toBe(false);
  });
});

describe("fromKeyEvent", () => {
  it("records Cmd on macOS and Ctrl elsewhere as mod", () => {
    expect(fromKeyEvent(press({ key: "K", metaKey: true, shiftKey: true }), true)).toEqual({
      shortcut: { key: "k", mod: true, shift: true },
    });
    expect(fromKeyEvent(press({ key: "k", ctrlKey: true }), false)).toEqual({
      shortcut: { key: "k", mod: true },
    });
    expect(fromKeyEvent(press({ key: "Tab", ctrlKey: true }), true)).toEqual({
      shortcut: { key: "Tab", ctrl: true },
    });
  });

  it("waits while only modifiers are held", () => {
    expect(fromKeyEvent(press({ key: "Meta", metaKey: true }), true)).toBeNull();
  });

  it("refuses keys without a modifier, and Option/Alt", () => {
    expect(fromKeyEvent(press({ key: "k" }), true)).toEqual({ error: "modifier" });
    expect(fromKeyEvent(press({ key: "k", metaKey: true, altKey: true }), true)).toEqual({
      error: "alt",
    });
    expect(fromKeyEvent(press({ key: "F5" }), true)).toEqual({ shortcut: { key: "F5" } });
  });
});

describe("recording limits", () => {
  it("waits through dead keys and refuses reserved ones", () => {
    expect(fromKeyEvent(press({ key: "Dead", metaKey: true }), true)).toBeNull();
    expect(fromKeyEvent(press({ key: "z", metaKey: true }), true)).toEqual({ error: "reserved" });
    expect(fromKeyEvent(press({ key: "ArrowUp", metaKey: true }), true)).toEqual({
      shortcut: { key: "ArrowUp", mod: true },
    });
  });

  it("counts the + alias as zoom in", () => {
    expect(conflicts("palette", { key: "+", mod: true }, {})).toEqual(["zoomIn"]);
  });
});
