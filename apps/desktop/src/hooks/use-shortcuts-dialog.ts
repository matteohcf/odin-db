import { create } from "zustand";

/** Whether the keyboard shortcuts overview is open; any feature can open it. */
export const useShortcutsDialog = create<{ open: boolean; setOpen: (open: boolean) => void }>()(
  (set) => ({ open: false, setOpen: (open) => set({ open }) }),
);
