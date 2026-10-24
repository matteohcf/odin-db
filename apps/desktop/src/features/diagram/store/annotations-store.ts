import type { DiagramLink } from "@odin-db/bindings";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  type DiagramAnnotations,
  type DiagramNote,
  linkId,
  NO_ANNOTATIONS,
} from "../lib/annotations";

interface AnnotationsState {
  /** By `profileId/database`. */
  byDatabase: Record<string, DiagramAnnotations>;
  /** Draws a reference, or shows it again if it was an inferred one the user had hidden. */
  addLink: (key: string, link: DiagramLink) => void;
  removeLink: (key: string, id: string) => void;
  hideLink: (key: string, id: string) => void;
  showHidden: (key: string) => void;
  addNote: (key: string, note: DiagramNote) => void;
  updateNote: (key: string, id: string, patch: Partial<Omit<DiagramNote, "id">>) => void;
  removeNote: (key: string, id: string) => void;
}

export const useAnnotations = create<AnnotationsState>()(
  persist(
    (set) => {
      const edit = (key: string, change: (current: DiagramAnnotations) => DiagramAnnotations) =>
        set((state) => ({
          byDatabase: {
            ...state.byDatabase,
            [key]: change(state.byDatabase[key] ?? NO_ANNOTATIONS),
          },
        }));
      return {
        byDatabase: {},
        addLink: (key, link) =>
          edit(key, (current) => {
            const id = linkId(link);
            if (current.hidden.includes(id))
              return { ...current, hidden: current.hidden.filter((other) => other !== id) };
            if (current.links.some((other) => linkId(other) === id)) return current;
            return { ...current, links: [...current.links, link] };
          }),
        removeLink: (key, id) =>
          edit(key, (current) => ({
            ...current,
            links: current.links.filter((link) => linkId(link) !== id),
          })),
        hideLink: (key, id) =>
          edit(key, (current) => ({ ...current, hidden: [...current.hidden, id] })),
        showHidden: (key) => edit(key, (current) => ({ ...current, hidden: [] })),
        addNote: (key, note) =>
          edit(key, (current) => ({ ...current, notes: [...current.notes, note] })),
        updateNote: (key, id, patch) =>
          edit(key, (current) => ({
            ...current,
            notes: current.notes.map((note) => (note.id === id ? { ...note, ...patch } : note)),
          })),
        removeNote: (key, id) =>
          edit(key, (current) => ({
            ...current,
            notes: current.notes.filter((note) => note.id !== id),
          })),
      };
    },
    { name: "odin-diagram-annotations", version: 1 },
  ),
);
