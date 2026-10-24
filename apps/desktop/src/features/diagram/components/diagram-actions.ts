import type { ProfileColor } from "@odin-db/bindings";
import { createContext } from "react";

/** What diagram nodes and edges can ask of their tab, without passing functions through data. */
export const DiagramActions = createContext<{
  onOpen: (collection: string) => void;
  onRemoveLink: (id: string) => void;
  onHideLink: (id: string) => void;
  onNoteChange: (id: string, text: string) => void;
  onNoteResize: (id: string, box: { x: number; y: number; width: number; height: number }) => void;
  onRemoveNote: (id: string) => void;
  onAreaChange: (id: string, patch: { label?: string; color?: ProfileColor }) => void;
  onAreaResize: (id: string, box: { x: number; y: number; width: number; height: number }) => void;
  onRemoveArea: (id: string) => void;
}>({
  onOpen: () => {},
  onRemoveLink: () => {},
  onHideLink: () => {},
  onNoteChange: () => {},
  onNoteResize: () => {},
  onRemoveNote: () => {},
  onAreaChange: () => {},
  onAreaResize: () => {},
  onRemoveArea: () => {},
});
