import type { ConnectionId } from "@odin-db/bindings";
import { create } from "zustand";

interface HealthState {
  /** Connections whose servers stopped answering heartbeats. */
  unreachable: Partial<Record<ConnectionId, true>>;
  setReachable: (connectionId: ConnectionId, reachable: boolean) => void;
}

export const useConnectionHealth = create<HealthState>()((set) => ({
  unreachable: {},
  setReachable: (connectionId, reachable) =>
    set((state) => {
      const { [connectionId]: _, ...rest } = state.unreachable;
      return { unreachable: reachable ? rest : { ...rest, [connectionId]: true } };
    }),
}));
