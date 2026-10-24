import { cn } from "@odin-db/ui/lib/utils";
import type { ReactNode } from "react";

interface QueryFieldFrameProps {
  label: string;
  invalid: boolean;
  className?: string;
  children: ReactNode;
  /** Inside the frame, after the editor: e.g. a clear button. */
  end?: ReactNode;
}

/** The frame of a query bar field, with its label inside like a terminal prompt. */
export function QueryFieldFrame({
  label,
  invalid,
  className,
  children,
  end,
}: QueryFieldFrameProps) {
  return (
    <div
      className={cn(
        "flex h-8 min-w-0 items-center rounded-md border bg-background shadow-xs transition-colors focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/40",
        invalid &&
          "border-destructive focus-within:border-destructive focus-within:ring-destructive/20",
        className,
      )}
    >
      <span aria-hidden className="shrink-0 select-none pr-2 pl-2.5 text-muted-foreground text-xs">
        {label}
      </span>
      {children}
      {end}
    </div>
  );
}
