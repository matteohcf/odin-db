import { createStore } from "zustand/vanilla";
import { templateFor } from "../lib/operators";
import type { Stage } from "../lib/pipeline";

interface PipelineState {
  stages: Stage[];
  add: (operator: string, afterId?: string) => void;
  update: (id: string, patch: Partial<Omit<Stage, "id">>) => void;
  /** Changes the operator, replacing the body only if it was untouched. */
  setOperator: (id: string, operator: string, field?: string) => void;
  remove: (id: string) => void;
  move: (id: string, delta: -1 | 1) => void;
  /** Replaces the whole pipeline, e.g. with a saved one. */
  replace: (stages: readonly Omit<Stage, "id">[]) => void;
}

const newStage = (operator: string): Stage => ({
  id: crypto.randomUUID(),
  operator,
  body: templateFor(operator),
  enabled: true,
});

/** One pipeline per collection tab. */
export function createPipelineStore() {
  return createStore<PipelineState>()((set) => ({
    stages: [newStage("$match")],
    add: (operator, afterId) =>
      set((state) => {
        const index = afterId
          ? state.stages.findIndex((s) => s.id === afterId) + 1
          : state.stages.length;
        const stages = [...state.stages];
        stages.splice(index, 0, newStage(operator));
        return { stages };
      }),
    update: (id, patch) =>
      set((state) => ({ stages: state.stages.map((s) => (s.id === id ? { ...s, ...patch } : s)) })),
    setOperator: (id, operator, field) =>
      set((state) => ({
        stages: state.stages.map((s) => {
          if (s.id !== id) return s;
          const untouched =
            s.body.trim() === "" ||
            s.body === templateFor(s.operator) ||
            s.body === templateFor(s.operator, field);
          return { ...s, operator, body: untouched ? templateFor(operator, field) : s.body };
        }),
      })),
    remove: (id) => set((state) => ({ stages: state.stages.filter((s) => s.id !== id) })),
    replace: (stages) =>
      set({ stages: stages.map((stage) => ({ ...stage, id: crypto.randomUUID() })) }),
    move: (id, delta) =>
      set((state) => {
        const index = state.stages.findIndex((s) => s.id === id);
        const target = index + delta;
        if (index < 0 || target < 0 || target >= state.stages.length) return state;
        const stages = [...state.stages];
        const [moved] = stages.splice(index, 1);
        if (moved) stages.splice(target, 0, moved);
        return { stages };
      }),
  }));
}
