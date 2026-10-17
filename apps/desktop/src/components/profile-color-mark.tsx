import type { ProfileColor } from "@odin-db/bindings";
import { cn } from "@odin-db/ui/lib/utils";
import { PROFILE_COLOR_CLASS } from "@/lib/profile-colors";

/** A connection's label color as a small bar; nothing when it has none. */
export function ProfileColorMark({
  color,
  className,
}: {
  color: ProfileColor | null | undefined;
  className?: string;
}) {
  if (!color) return null;
  return (
    <span
      aria-hidden
      className={cn("h-3 w-1 shrink-0 rounded-full", PROFILE_COLOR_CLASS[color].bg, className)}
    />
  );
}
