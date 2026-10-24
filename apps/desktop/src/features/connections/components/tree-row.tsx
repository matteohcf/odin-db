import { cn } from "@odin-db/ui/lib/utils";
import { Loader2, Play } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import { MenuButton } from "@/components/menu-button";
import { PointerMenu } from "@/components/pointer-menu";
import { usePointerMenu } from "@/hooks/use-pointer-menu";

interface TreeRowProps {
  depth: number;
  label: ReactNode;
  icon: ReactNode;
  /** `undefined` for leaves, which get no chevron. */
  expanded?: boolean;
  loading?: boolean;
  trailing?: ReactNode;
  /** `DropdownMenuItem`s, shown by the "…" button and on right-click. */
  menu?: ReactNode;
  menuLabel?: string;
  /** One-click actions (`IconAction`) shown on hover before the "…" button. */
  quickActions?: ReactNode;
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
  menu,
  menuLabel = "",
  quickActions,
  muted,
  active,
  onActivate,
  onAuxActivate,
  title,
}: TreeRowProps) {
  const hasActions = Boolean(menu || quickActions);
  const pointerMenu = usePointerMenu();
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: right-click is a pointer shortcut; the "…" button opens the same menu from the keyboard.
    <div
      onContextMenu={menu ? pointerMenu.onContextMenu : undefined}
      data-state={pointerMenu.at ? "open" : undefined}
      className={cn(
        // The sidebar sets --tree-row from the density setting.
        // Full-width rows like Compass: hover and selection span the whole sidebar.
        "group relative flex h-(--tree-row) items-center text-[13px] hover:bg-accent data-[state=open]:bg-accent",
        muted ? "text-muted-foreground" : "text-foreground",
        active && "bg-accent font-semibold",
      )}
    >
      <button
        type="button"
        onClick={onActivate}
        onAuxClick={(event) => event.button === 1 && onAuxActivate?.()}
        aria-expanded={expanded}
        aria-current={active ? "page" : undefined}
        title={title}
        className="flex h-full min-w-0 flex-1 items-center gap-1.5 pr-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
      >
        <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
          {loading ? (
            <Loader2 className="size-3 animate-spin" />
          ) : expanded === undefined ? null : (
            <Play
              className={cn(
                "size-2.5 fill-current stroke-0 transition-transform duration-150",
                expanded && "rotate-90",
              )}
            />
          )}
        </span>
        <span className="flex shrink-0 items-center text-foreground/60">{icon}</span>
        <span className="truncate">{label}</span>
        {trailing && (
          <span
            className={cn(
              "ml-auto shrink-0 pl-2 text-muted-foreground text-xs",
              // The actions take the trailing details' place while shown.
              hasActions && "group-hover:invisible group-has-focus-visible:invisible",
            )}
          >
            {trailing}
          </span>
        )}
      </button>
      {hasActions && (
        <div
          className={cn(
            "absolute inset-y-0 right-0 flex items-center gap-0.5 bg-accent pr-2 pl-1 opacity-0",
            // Hidden visually only, so screen readers and Tab still reach the actions.
            "group-hover:opacity-100 group-has-focus-visible:opacity-100 has-[[data-state=open]]:opacity-100",
          )}
        >
          {quickActions}
          {menu && <MenuButton label={menuLabel}>{menu}</MenuButton>}
        </div>
      )}
      {menu && pointerMenu.at && (
        <PointerMenu at={pointerMenu.at} onClose={pointerMenu.close}>
          {menu}
        </PointerMenu>
      )}
    </div>
  );
}

export function TreeMessage({ depth, children }: { depth: number; children: ReactNode }) {
  return (
    <div
      className="flex h-(--tree-row) items-center text-muted-foreground text-xs"
      style={{ paddingLeft: `${depth * 20 + 32}px` }}
    >
      {children}
    </div>
  );
}
