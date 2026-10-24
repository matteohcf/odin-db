import { create } from "zustand";
import { persist } from "zustand/middleware";

type Positions = Record<string, { x: number; y: number }>;

interface PositionsState {
  /** Dragged node positions by `profileId/database`, then collection. */
  byDatabase: Record<string, Positions>;
  move: (key: string, collection: string, position: { x: number; y: number }) => void;
  /** Several at once, as when an area carries its collections. */
  moveMany: (key: string, moved: Positions) => void;
  /** Forgets the dragged positions, so the automatic layout applies again. */
  reset: (key: string) => void;
}

export const usePositions = create<PositionsState>()(
  persist(
    (set) => ({
      byDatabase: {},
      move: (key, collection, position) =>
        set((state) => ({
          byDatabase: {
            ...state.byDatabase,
            [key]: { ...state.byDatabase[key], [collection]: position },
          },
        })),
      moveMany: (key, moved) =>
        set((state) => ({
          byDatabase: { ...state.byDatabase, [key]: { ...state.byDatabase[key], ...moved } },
        })),
      reset: (key) =>
        set((state) => {
          const { [key]: _, ...rest } = state.byDatabase;
          return { byDatabase: rest };
        }),
    }),
    { name: "odin-diagram-positions", version: 1 },
  ),
);
