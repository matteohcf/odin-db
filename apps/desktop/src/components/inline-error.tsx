import { cn } from "@odin-db/ui/lib/utils";
import { CircleAlert } from "lucide-react";
import type { ReactNode } from "react";

/** An error under a form or action: announced, selectable so it can be copied. */
export function InlineError({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      role="alert"
      className={cn("flex items-start gap-1.5 text-destructive text-xs selectable", className)}
    >
      <CircleAlert className="mt-px size-3.5 shrink-0" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}
