import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Stage } from "../lib/pipeline";

export interface SavedPipeline {
  name: string;
  stages: Omit<Stage, "id">[];
  savedAt: number;
}

interface SavedPipelinesState {
  /** Newest first, keyed by `pipelineKey`. */
  pipelines: Record<string, SavedPipeline[]>;
  /** Saves under `name`, replacing a pipeline with the same name. */
  save: (key: string, name: string, stages: readonly Stage[]) => void;
  remove: (key: string, name: string) => void;
}

export const pipelineKey = (profileId: string, database: string, collection: string) =>
  JSON.stringify([profileId, database, collection]);

/** Named pipelines per collection, kept across restarts. */
export const useSavedPipelines = create<SavedPipelinesState>()(
  persist(
    (set) => ({
      pipelines: {},
      save: (key, name, stages) =>
        set((state) => {
          const others = (state.pipelines[key] ?? []).filter((p) => p.name !== name);
          const saved: SavedPipeline = {
            name,
            stages: stages.map(({ operator, body, enabled }) => ({ operator, body, enabled })),
            savedAt: Date.now(),
          };
          return { pipelines: { ...state.pipelines, [key]: [saved, ...others] } };
        }),
      remove: (key, name) =>
        set((state) => ({
          pipelines: {
            ...state.pipelines,
            [key]: (state.pipelines[key] ?? []).filter((p) => p.name !== name),
          },
        })),
    }),
    { name: "odin-saved-pipelines", version: 1 },
  ),
);
