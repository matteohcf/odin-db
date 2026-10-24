import { Button } from "@odin-db/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@odin-db/ui/components/dropdown-menu";
import { cn } from "@odin-db/ui/lib/utils";
import { MoreHorizontal } from "lucide-react";
import { type ReactNode, useRef } from "react";

/** A "…" button opening a dropdown of `DropdownMenuItem`s. */
export function MenuButton({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  // Opened with the mouse, closing leaves focus alone instead of ringing the button.
  const byPointer = useRef(false);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className={cn("size-6", className)}
          aria-label={label}
          onPointerDown={() => {
            byPointer.current = true;
          }}
          onKeyDown={() => {
            byPointer.current = false;
          }}
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-52"
        onCloseAutoFocus={(event) => byPointer.current && event.preventDefault()}
      >
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
