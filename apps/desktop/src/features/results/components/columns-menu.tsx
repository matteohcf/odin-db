import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@odin-db/ui/components/dropdown-menu";
import { cn } from "@odin-db/ui/lib/utils";
import { Columns3 } from "lucide-react";
import { useTranslation } from "react-i18next";

interface ToggleableColumn {
  id: string;
  getIsVisible: () => boolean;
  toggleVisibility: (value?: boolean) => void;
}

/** Shows or hides columns; at least one stays visible. */
export function ColumnsMenu({
  columns,
  onShowAll,
  onFitAll,
  onReset,
}: {
  columns: readonly ToggleableColumn[];
  onShowAll: () => void;
  onFitAll: () => void;
  /** Back to the natural order, widths and visibility, with nothing pinned. */
  onReset: () => void;
}) {
  const { t } = useTranslation("results");
  const visible = columns.filter((column) => column.getIsVisible()).length;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("columns.choose")}
          title={t("columns.choose")}
          className={cn(
            "flex size-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground",
            visible < columns.length && "text-primary",
          )}
        >
          <Columns3 className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-96 w-56 overflow-y-auto">
        <DropdownMenuLabel className="text-muted-foreground text-xs">
          {t("columns.label", { visible, total: columns.length })}
        </DropdownMenuLabel>
        {columns.map((column) => (
          <DropdownMenuCheckboxItem
            key={column.id}
            checked={column.getIsVisible()}
            disabled={column.getIsVisible() && visible === 1}
            // Stay open: several columns are usually toggled at once.
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={(checked) => column.toggleVisibility(checked)}
            className="font-mono text-xs"
          >
            <span className="truncate">{column.id}</span>
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        {visible < columns.length && (
          <DropdownMenuItem onSelect={onShowAll}>{t("columns.showAll")}</DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={onFitAll}>{t("columns.fitAll")}</DropdownMenuItem>
        <DropdownMenuItem onSelect={onReset}>{t("columns.reset")}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
