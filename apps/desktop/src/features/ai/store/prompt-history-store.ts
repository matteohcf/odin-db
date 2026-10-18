import { create } from "zustand";
import { persist } from "zustand/middleware";

const LIMIT = 30;

interface PromptHistoryState {
  /** Requests sent to the assistant, most recent first, across collections. */
  prompts: string[];
  record: (prompt: string) => void;
}

/** Recent requests, recalled with Up and Down in an empty prompt; kept across restarts. */
export const usePromptHistory = create<PromptHistoryState>()(
  persist(
    (set) => ({
      prompts: [],
      record: (prompt) => {
        const text = prompt.trim();
        if (!text) return;
        set((state) => ({
          prompts: [text, ...state.prompts.filter((entry) => entry !== text)].slice(0, LIMIT),
        }));
      },
    }),
    { name: "odin-ai-prompts", version: 1 },
  ),
);
