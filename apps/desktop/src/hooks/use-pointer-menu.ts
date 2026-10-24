import { type MouseEvent, useState } from "react";
import type { PointerPosition } from "@/components/pointer-menu";

/** State for a `PointerMenu`: where the last right-click on the element happened. */
export function usePointerMenu() {
  const [at, setAt] = useState<PointerPosition | null>(null);
  return {
    at,
    close: () => setAt(null),
    onContextMenu: (event: MouseEvent<HTMLElement>) => {
      event.preventDefault();
      const box = event.currentTarget.getBoundingClientRect();
      setAt({ x: event.clientX - box.left, y: event.clientY - box.top });
    },
  };
}
