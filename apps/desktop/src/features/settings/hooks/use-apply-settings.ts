import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useShortcut } from "@/hooks/use-shortcut";
import { resolveLanguage } from "@/lib/i18n";
import { DEFAULT_SETTINGS, stepZoom, useSettings } from "@/lib/settings";

/** Applies the settings that act on the whole window, and binds their shortcuts. */
export function useApplySettings() {
  const { i18n } = useTranslation();
  const language = useSettings((s) => s.language);
  const zoom = useSettings((s) => s.zoom);
  const editorFontSize = useSettings((s) => s.editorFontSize);
  const update = useSettings((s) => s.update);
  const accent = useSettings((s) => s.accent);
  const darkStyle = useSettings((s) => s.darkStyle);
  const monoFont = useSettings((s) => s.monoFont);
  const uiFont = useSettings((s) => s.uiFont);

  useEffect(() => {
    const resolved = resolveLanguage(language);
    document.documentElement.lang = resolved;
    if (i18n.language !== resolved) void i18n.changeLanguage(resolved);
  }, [language, i18n]);

  useEffect(() => {
    // The webview's own zoom scales everything, popovers included; the browser
    // preview (mock backend) has no webview, so it falls back to CSS zoom.
    if (isTauri()) void getCurrentWebview().setZoom(zoom / 100);
    else document.documentElement.style.zoom = `${zoom}%`;
  }, [zoom]);

  useEffect(() => {
    document.documentElement.style.setProperty("--editor-font-size", `${editorFontSize}px`);
  }, [editorFontSize]);

  useEffect(() => {
    // Read by the accent and dark style rules of the design tokens.
    document.documentElement.dataset.accent = accent;
    document.documentElement.dataset.darkStyle = darkStyle;
  }, [accent, darkStyle]);

  useEffect(() => {
    const style = document.documentElement.style;
    const font = monoFont.trim().replaceAll('"', "");
    // Falls back to the bundled font for glyphs the chosen one lacks, or if it is missing.
    if (font)
      style.setProperty("--odin-mono", `"${font}", "IBM Plex Mono", ui-monospace, monospace`);
    else style.removeProperty("--odin-mono");
  }, [monoFont]);

  useEffect(() => {
    const style = document.documentElement.style;
    if (uiFont === "system") {
      style.setProperty(
        "--odin-sans",
        '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
      );
    } else style.removeProperty("--odin-sans");
  }, [uiFont]);

  const zoomIn = () => update({ zoom: stepZoom(useSettings.getState().zoom, 1) });
  useShortcut("zoomIn", zoomIn);
  useShortcut("zoomInPlus", zoomIn);
  useShortcut("zoomOut", () => update({ zoom: stepZoom(useSettings.getState().zoom, -1) }));
  useShortcut("resetZoom", () => update({ zoom: DEFAULT_SETTINGS.zoom }));
}
