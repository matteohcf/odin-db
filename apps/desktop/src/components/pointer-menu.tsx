import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@odin-db/ui/components/dropdown-menu";
import type { ReactNode } from "react";

export interface PointerPosition {
  x: number;
  y: number;
}

/**
 * A right-click menu of `DropdownMenuItem`s opened at the pointer. Mounted only while open, so
 * long lists can offer one on every row at no cost; `at` is relative to the positioned parent.
 */
export function PointerMenu({
  at,
  onClose,
  children,
}: {
  at: PointerPosition;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <DropdownMenu open onOpenChange={(open) => !open && onClose()}>
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden
          className="pointer-events-none absolute size-0"
          style={{ left: at.x, top: at.y }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
