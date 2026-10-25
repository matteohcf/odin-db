import { cn } from "@odin-db/ui/lib/utils";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface EmptyStateProps {
  icon: LucideIcon;
  title?: ReactNode;
  /** What to do next, or why there is nothing. */
  children?: ReactNode;
  /** A next step, e.g. a button. */
  action?: ReactNode;
  /** For an icon that signals activity, e.g. a pulse while waiting. */
  iconClassName?: string | undefined;
}

/** What fills a view with nothing to show: centered icon, title, hint and next step. */
export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  iconClassName,
}: EmptyStateProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
      <Icon className={cn("size-5 text-muted-foreground", iconClassName)} />
      {title && <p className="font-medium text-sm">{title}</p>}
      {children && (
        <p className="max-w-md text-muted-foreground text-xs leading-relaxed selectable">
          {children}
        </p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
