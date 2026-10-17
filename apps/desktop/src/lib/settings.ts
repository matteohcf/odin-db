import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { CodeLanguage } from "./query-code";

/**
 * User preferences. Flat on purpose: a new setting is one field here plus its
 * default, and stored settings from older versions pick up the defaults.
 */
export interface Settings {
  language: "system" | "en" | "it";
  /** Interface zoom, in percent. */
  zoom: number;
  editorFontSize: number;
  /** Documents fetched per round trip while scrolling results. */
  resultsBatchSize: number;
  /** Rows kept in memory per result; beyond it the result is truncated. */
  resultsMaxRows: number;
  shellFontSize: number;
  shellScrollback: number;
  /** Recent queries remembered per collection. */
  queryHistorySize: number;
  /** Last language picked in the query code dialog. */
  queryCodeLanguage: CodeLanguage;
  /** Sidebar width in pixels, set by dragging its edge. */
  sidebarWidth: number;
  /** The color of selection, focus and primary actions. */
  accent: Accent;
  /** Dark mode surfaces: graphite, or pure black for OLED screens and dark rooms. */
  darkStyle: "graphite" | "black";
  /** Height of result rows. */
  rowDensity: RowDensity;
  /** Reconnect at launch the connections that restored tabs use. */
  reconnectOnLaunch: boolean;
}

export const ACCENTS = ["indigo", "blue", "teal", "green", "orange", "rose", "violet"] as const;
type Accent = (typeof ACCENTS)[number];

export const ROW_HEIGHTS = { compact: 24, normal: 30, comfortable: 36 } as const;
export type RowDensity = keyof typeof ROW_HEIGHTS;

export const DEFAULT_SETTINGS: Settings = {
  language: "system",
  zoom: 100,
  editorFontSize: 12.5,
  resultsBatchSize: 100,
  resultsMaxRows: 20_000,
  shellFontSize: 13,
  shellScrollback: 10_000,
  queryHistorySize: 50,
  queryCodeLanguage: "javascript",
  sidebarWidth: 256,
  accent: "indigo",
  darkStyle: "graphite",
  rowDensity: "normal",
  reconnectOnLaunch: true,
};

export const SIDEBAR_WIDTH = { min: 200, max: 520 } as const;

export const clampSidebarWidth = (width: number) =>
  Math.round(Math.min(SIDEBAR_WIDTH.max, Math.max(SIDEBAR_WIDTH.min, width)));

export const ZOOM_LEVELS = [80, 90, 100, 110, 125, 150] as const;

interface SettingsState extends Settings {
  update: (patch: Partial<Settings>) => void;
  reset: () => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      update: (patch) => set(patch),
      reset: () => set(DEFAULT_SETTINGS),
    }),
    { name: "odin-settings", version: 1 },
  ),
);

/** The next zoom level up or down from `zoom`, staying within the steps. */
export function stepZoom(zoom: number, direction: 1 | -1): number {
  const next =
    direction === 1
      ? ZOOM_LEVELS.find((level) => level > zoom)
      : ZOOM_LEVELS.findLast((level) => level < zoom);
  return next ?? zoom;
}
