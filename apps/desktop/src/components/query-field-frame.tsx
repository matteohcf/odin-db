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
    // biome-ignore lint/a11y/noStaticElementInteractions: the field inside is what takes focus.
    <div
      // Clicking the label or the padding focuses the field, like a native input's box.
      onMouseDown={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest("input, button, .cm-editor")) return;
        const field = event.currentTarget.querySelector<HTMLElement>("input, .cm-content");
        if (!field) return;
        event.preventDefault();
        field.focus();
      }}
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
