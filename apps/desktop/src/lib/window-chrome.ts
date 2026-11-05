import type { Theme } from "@odin-db/ui/components/theme-provider";

interface TitleBarInput {
  /** Running in the Tauri webview, not the browser preview. */
  native: boolean;
  userAgent: string;
  fullscreen: boolean;
  /** The browser preview asks for the macOS look (`?titlebar=overlay`), to review it. */
  preview?: boolean;
}

/**
 * Whether the window draws its title bar over the content (ADR-0062): only macOS,
 * where `tauri.macos.conf.json` sets `titleBarStyle: Overlay`. Fullscreen hides the
 * traffic lights, so nothing needs to make room for them there.
 */
export function hasOverlayTitleBar({ native, userAgent, fullscreen, preview }: TitleBarInput) {
  if (fullscreen) return false;
  return native ? /Macintosh|Mac OS X/.test(userAgent) : preview === true;
}

/** The native window theme for an app theme; `null` follows the system. */
export const nativeWindowTheme = (theme: Theme) => (theme === "system" ? null : theme);
