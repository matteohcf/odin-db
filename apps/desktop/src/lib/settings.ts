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
}

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
};

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
