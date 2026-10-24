import { Button } from "@odin-db/ui/components/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@odin-db/ui/components/tooltip";
import { cn } from "@odin-db/ui/lib/utils";
import type { MouseEvent, ReactNode } from "react";

/** A small icon-only button named by its tooltip: row, card and toolbar actions. */
export function IconAction({
  label,
  onClick,
  className,
  disabled,
  children,
}: {
  label: string;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  className?: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          // Keeps a click from also selecting or dragging the row or card underneath.
          onMouseDown={(event) => event.stopPropagation()}
          className={cn("size-6 text-muted-foreground [&_svg]:size-3.5", className)}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
