import { describe, expect, it } from "vitest";
import { hasOverlayTitleBar, nativeWindowTheme } from "./window-chrome";

const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15";
const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edg/130.0";
const LINUX = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15";

describe("hasOverlayTitleBar", () => {
  it("is on in the macOS app only", () => {
    expect(hasOverlayTitleBar({ native: true, userAgent: MAC, fullscreen: false })).toBe(true);
    expect(hasOverlayTitleBar({ native: true, userAgent: WINDOWS, fullscreen: false })).toBe(false);
    expect(hasOverlayTitleBar({ native: true, userAgent: LINUX, fullscreen: false })).toBe(false);
  });

  it("is off in fullscreen, where the traffic lights are hidden", () => {
    expect(hasOverlayTitleBar({ native: true, userAgent: MAC, fullscreen: true })).toBe(false);
  });

  it("is off in the browser preview unless asked for", () => {
    expect(hasOverlayTitleBar({ native: false, userAgent: MAC, fullscreen: false })).toBe(false);
    expect(
      hasOverlayTitleBar({ native: false, userAgent: LINUX, fullscreen: false, preview: true }),
    ).toBe(true);
  });
});

describe("nativeWindowTheme", () => {
  it("follows the system unless a theme is picked", () => {
    expect(nativeWindowTheme("system")).toBeNull();
    expect(nativeWindowTheme("dark")).toBe("dark");
    expect(nativeWindowTheme("light")).toBe("light");
  });
});
