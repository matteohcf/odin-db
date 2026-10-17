import { describe, expect, it } from "vitest";
import { label, matches, SHORTCUTS } from "./shortcuts";

const event = (press: {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
}) => ({
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...press,
});

describe("shortcuts", () => {
  it("maps Mod to Cmd on macOS and Ctrl elsewhere", () => {
    expect(matches(SHORTCUTS.palette, event({ key: "k", metaKey: true }), true)).toBe(true);
    expect(matches(SHORTCUTS.palette, event({ key: "k", ctrlKey: true }), true)).toBe(false);
    expect(matches(SHORTCUTS.palette, event({ key: "k", ctrlKey: true }), false)).toBe(true);
    expect(
      matches(SHORTCUTS.palette, event({ key: "K", metaKey: true, shiftKey: true }), true),
    ).toBe(false);
  });

  it("tells Ctrl+Tab from Ctrl+Shift+Tab", () => {
    const tab = event({ key: "Tab", ctrlKey: true, shiftKey: true });
    expect(matches(SHORTCUTS.previousTab, tab, true)).toBe(true);
    expect(matches(SHORTCUTS.nextTab, tab, true)).toBe(false);
  });

  it("labels per platform", () => {
    expect(label(SHORTCUTS.palette, true)).toBe("⌘ K");
    expect(label(SHORTCUTS.palette, false)).toBe("Ctrl K");
    expect(label(SHORTCUTS.previousTab, false)).toBe("Ctrl Shift Tab");
  });
});
