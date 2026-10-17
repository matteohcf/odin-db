import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@odin-db/ui/components/dropdown-menu";
import { cn } from "@odin-db/ui/lib/utils";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ClipboardCopy,
  EyeOff,
  ListChecks,
  MoveHorizontal,
  SquareCheck,
  SquareDashed,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { ColumnActions } from "./results-grid";

interface ColumnMenuProps {
  field: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  columnActions: ColumnActions | undefined;
  onFit: () => void;
  /** Absent when this is the last visible column. */
  onHide: (() => void) | undefined;
}

/** A column's commands, from the chevron in its header or a right-click on it. */
export function ColumnMenu({
  field,
  open,
  onOpenChange,
  columnActions,
  onFit,
  onHide,
}: ColumnMenuProps) {
  const { t } = useTranslation("results");
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("column.menu", { field })}
          className={cn(
            // Overlays the end of the header, so narrow columns keep their full label.
            "absolute top-1/2 right-2 flex size-5 -translate-y-1/2 items-center justify-center rounded-sm bg-sidebar text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover/header:opacity-100",
            open ? "opacity-100" : "opacity-0",
          )}
        >
          <ChevronDown className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {columnActions?.onSortBy && (
          <>
            <DropdownMenuItem onSelect={() => columnActions.onSortBy?.(field, 1)}>
              <ArrowUp />
              {t("column.sortAscending")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => columnActions.onSortBy?.(field, -1)}>
              <ArrowDown />
              {t("column.sortDescending")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        {columnActions && (
          <>
            <DropdownMenuItem onSelect={() => columnActions.onFilterBy(field, undefined, "ne")}>
              <SquareCheck />
              {t("column.exists")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => columnActions.onFilterBy(field, undefined, "eq")}>
              <SquareDashed />
              {t("column.missing")}
            </DropdownMenuItem>
            {columnActions.onDistinct && (
              <DropdownMenuItem onSelect={() => columnActions.onDistinct?.(field)}>
                <ListChecks />
                {t("cell.distinct", { field })}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem onSelect={onFit}>
          <MoveHorizontal />
          {t("column.fit")}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!onHide} onSelect={() => onHide?.()}>
          <EyeOff />
          {t("column.hide")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            void navigator.clipboard.writeText(field);
            toast.success(t("column.copied", { field }));
          }}
        >
          <ClipboardCopy />
          {t("column.copyName")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
