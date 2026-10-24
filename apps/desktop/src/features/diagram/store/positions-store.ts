import { create } from "zustand";
import { persist } from "zustand/middleware";

type Positions = Record<string, { x: number; y: number }>;

interface PositionsState {
  /** Dragged node positions by `profileId/database`, then collection. */
  byDatabase: Record<string, Positions>;
  /** Where the collections dragged (or carried by an area) ended up. */
  moveMany: (key: string, moved: Positions) => void;
  /** Forgets the dragged positions, so the automatic layout applies again. */
  reset: (key: string) => void;
}

export const usePositions = create<PositionsState>()(
  persist(
    (set) => ({
      byDatabase: {},
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
