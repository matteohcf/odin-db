import { type DroppedFile, events } from "@odin-db/bindings";
import { useEffect, useRef, useState } from "react";

type Handler = (files: DroppedFile[]) => void;
/** Mounted drop targets; the most recent one (the open dialog) takes a drop. */
const targets: { current: Handler }[] = [];

/**
 * Files dragged onto the window (ADR-0051): whether some are over it now, and the dropped ones
 * for the most recently mounted target. Paths never reach the UI, only tokens.
 */
export function useFileDrop(onDrop: Handler): { hovering: boolean } {
  const [hovering, setHovering] = useState(false);
  const handler = useRef(onDrop);
  handler.current = onDrop;

  useEffect(() => {
    targets.push(handler);
    const dragging = events.fileDragChanged.listen(({ payload }) => setHovering(payload.hovering));
    const dropped = events.filesDropped.listen(({ payload }) => {
      if (targets.at(-1) === handler) handler.current(payload.files);
    });
    return () => {
      targets.splice(targets.indexOf(handler), 1);
      void dragging.then((unlisten) => unlisten());
      void dropped.then((unlisten) => unlisten());
    };
  }, []);

  return { hovering };
}
