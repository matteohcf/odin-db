import { useTheme } from "@odin-db/ui/components/theme-provider";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";
import { hasOverlayTitleBar, nativeWindowTheme } from "@/lib/window-chrome";

const native = isTauri();
const preview =
  import.meta.env.DEV && new URLSearchParams(window.location.search).get("titlebar") === "overlay";

/**
 * Keeps the native window in step with the app (ADR-0062): its theme follows the
 * app's, so a native title bar matches it, and reports whether the macOS title bar
 * is drawn over the content, so the sidebar makes room for the traffic lights.
 */
export function useWindowChrome() {
  const { theme } = useTheme();
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (native) void getCurrentWindow().setTheme(nativeWindowTheme(theme));
  }, [theme]);

  useEffect(() => {
    if (!native) return;
    const window = getCurrentWindow();
    let live = true;
    // Entering and leaving fullscreen end with a resize, after the state has changed.
    const sync = () =>
      void window.isFullscreen().then((value) => {
        if (live) setFullscreen(value);
      });
    sync();
    const unlisten = window.onResized(sync);
    return () => {
      live = false;
      void unlisten.then((stop) => stop());
    };
  }, []);

  return {
    overlayTitleBar: hasOverlayTitleBar({
      native,
      userAgent: navigator.userAgent,
      fullscreen,
      preview,
    }),
  };
}
