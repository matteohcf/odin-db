import type { EJsonDocument, IpcError } from "@odin-db/bindings";
import { createStore } from "zustand/vanilla";
import { isJsonObject, type JsonObject } from "../../../lib/ejson-display";

type ResultStatus =
  | { type: "idle" }
  | { type: "loading" }
  | { type: "completed" }
  | { type: "cancelled" }
  | { type: "failed"; error: IpcError };

interface ResultState {
  rows: JsonObject[];
  status: ResultStatus;
  reset: () => void;
  append: (rows: readonly EJsonDocument[]) => void;
  setStatus: (status: ResultStatus) => void;
}

/** One store per result tab; fed by a streaming operation (ADR-0010). */
export function createResultStore() {
  return createStore<ResultState>()((set) => ({
    rows: [],
    status: { type: "idle" },
    reset: () => set({ rows: [], status: { type: "loading" } }),
    // Top-level BSON values are always documents; anything else is dropped at the boundary.
    append: (rows) => set((state) => ({ rows: state.rows.concat(rows.filter(isJsonObject)) })),
    setStatus: (status) => set({ status }),
  }));
}
