import type { ReactNode } from "react";

/** A section's message where its table would be: measuring, nothing running, and the like. */
export function SectionNote({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border p-6 text-center text-muted-foreground text-sm">{children}</p>
  );
}
