import type { ProfileId } from "@odin-db/bindings";
import { create } from "zustand";

export interface HostKeyPrompt {
  profileId: ProfileId;
  fingerprint: string;
  /** The server's key differs from the trusted one. */
  changed: boolean;
}

/** The SSH host key waiting for the user's decision, if any. */
export const useHostKeyPrompt = create<{
  prompt: HostKeyPrompt | null;
  ask: (prompt: HostKeyPrompt) => void;
  dismiss: () => void;
}>()((set) => ({
  prompt: null,
  ask: (prompt) => set({ prompt }),
  dismiss: () => set({ prompt: null }),
}));
