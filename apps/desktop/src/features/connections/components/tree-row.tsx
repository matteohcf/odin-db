import { cn } from "@odin-db/ui/lib/utils";
import { ChevronRight, Loader2 } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";

interface TreeRowProps {
  depth: number;
  label: ReactNode;
  icon: ReactNode;
  /** `undefined` for leaves, which get no chevron. */
  expanded?: boolean;
  loading?: boolean;
  trailing?: ReactNode;
  actions?: ReactNode;
  muted?: boolean;
  /** The row of what the active tab shows. */
  active?: boolean;
  onActivate: (event: MouseEvent) => void;
  /** Middle click; leaves default to nothing. */
  onAuxActivate?: (() => void) | undefined;
  title?: string;
}

/** One row of the connection tree; every level shares its geometry. */
export function TreeRow({
  depth,
  label,
  icon,
  expanded,
  loading,
  trailing,
  actions,
  muted,
  active,
  onActivate,
  onAuxActivate,
  title,
}: TreeRowProps) {
  return (
    <div
      className={cn(
        // The sidebar sets --tree-row from the density setting.
        "group relative flex h-(--tree-row) items-center rounded-md pr-1 text-[13px] hover:bg-accent",
        muted ? "text-muted-foreground" : "text-foreground",
        active && "bg-accent font-medium",
      )}
    >
      <button
        type="button"
        onClick={onActivate}
        onAuxClick={(event) => event.button === 1 && onAuxActivate?.()}
        aria-expanded={expanded}
        aria-current={active ? "page" : undefined}
        title={title}
        className="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        style={{ paddingLeft: `${depth * 14 + 6}px` }}
      >
        <span className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground">
          {loading ? (
            <Loader2 className="size-3 animate-spin" />
          ) : expanded === undefined ? null : (
            <ChevronRight
              className={cn("size-3.5 transition-transform", expanded && "rotate-90")}
            />
          )}
        </span>
        <span className="flex shrink-0 items-center text-muted-foreground">{icon}</span>
        <span className="truncate">{label}</span>
        {trailing && (
          <span className="ml-auto shrink-0 pl-2 text-muted-foreground text-xs">{trailing}</span>
        )}
      </button>
      {actions && (
        <div className="flex shrink-0 items-center opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 has-[[data-state=open]]:opacity-100">
          {actions}
        </div>
      )}
    </div>
  );
}

export function TreeMessage({ depth, children }: { depth: number; children: ReactNode }) {
  return (
    <div
      className="flex h-(--tree-row) items-center text-muted-foreground text-xs"
      style={{ paddingLeft: `${depth * 14 + 26}px` }}
    >
      {children}
    </div>
  );
}
