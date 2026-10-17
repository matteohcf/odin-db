import type { JsonValue } from "@odin-db/bindings";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@odin-db/ui/components/context-menu";
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
import {
  columnResizingFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  createColumnHelper,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowDown,
  ArrowUp,
  Columns3,
  Copy,
  Filter,
  ListChecks,
  PencilLine,
  Trash2,
} from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { EJsonCell } from "@/components/ejson-cell";
import { TypeIcon } from "@/components/type-icon";
import type { JsonObject } from "@/lib/ejson-display";
import { toShellSyntax } from "@/lib/shell-syntax";
import { columnWidth, dominantKind } from "../lib/columns";
import { modeOf, nextMarked, type SelectMode } from "../lib/selection";
import { RowMenuItems } from "./row-menu-items";

const ROW_HEIGHT = 30;
const INDEX_WIDTH = 56;
/** Start fetching the next page this many rows before the end. */
const PREFETCH_ROWS = 40;

const features = tableFeatures({
  columnSizingFeature,
  columnResizingFeature,
  columnVisibilityFeature,
});
const helper = createColumnHelper<typeof features, JsonObject>();

/** Row commands. Omitting `onDuplicate`/`onDelete` makes the results view-only. */
export interface RowActions {
  onOpen: (row: JsonObject) => void;
  openMode: "edit" | "view";
  onCopy: (row: JsonObject) => void;
  onDuplicate?: ((row: JsonObject) => void) | undefined;
  onDelete?: ((row: JsonObject) => void) | undefined;
  /** Edits one top-level field. Omitted for read-only results. */
  onEditField?: ((row: JsonObject, field: string) => void) | undefined;
  /** Several selected documents at once (Shift/Cmd-click in the table). */
  onCopyMany?: ((rows: JsonObject[]) => void) | undefined;
  onDeleteMany?: ((rows: JsonObject[]) => void) | undefined;
}

/** Query shortcuts from the grid. Omitted where results do not come from a query bar. */
export interface ColumnActions {
  /** The fields results are sorted by, in order. Empty when unsorted or not shown. */
  sort: readonly { field: string; direction: 1 | -1 }[];
  /** A column was clicked; with `append` (Shift) it joins the current sort. */
  onSort: (field: string, append: boolean) => void;
  /** `undefined` means the document has no such field. */
  onFilterBy: (field: string, value: JsonValue | undefined) => void;
  /** Shows the field's distinct values among the matching documents. */
  onDistinct?: (field: string) => void;
}

interface ResultsGridProps {
  label: string;
  rows: readonly JsonObject[];
  columns: readonly string[];
  hasMore: boolean;
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  onLoadMore: () => void;
  actions: RowActions;
  columnActions?: ColumnActions | undefined;
}

/**
 * Virtualized document grid, laid out as a CSS-grid `<table>` so it keeps table
 * semantics. TanStack Table owns the column model; cells render straight from the
 * documents, since its per-row cell objects do not scale to tens of thousands of
 * rows (docs/milestone-0.md, finding 2). Focus stays on the table and the selected
 * row is announced through `aria-activedescendant`.
 */
export function ResultsGrid({
  label,
  rows,
  columns,
  hasMore,
  selectedIndex,
  onSelect,
  onLoadMore,
  actions,
  columnActions,
}: ResultsGridProps) {
  const { t } = useTranslation("results");
  const { onOpen, onDelete } = actions;
  const gridId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  // The column under the pointer when the context menu opened, for cell actions.
  const [menuColumn, setMenuColumn] = useState<string | null>(null);
  // Rows marked with Shift/Cmd-click; the selected row is the active one among them.
  const [marked, setMarked] = useState<ReadonlySet<number>>(() => new Set());
  const anchor = useRef<number | null>(null);
  const firstRow = rows[0];
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new first row means a new result set.
  useEffect(() => {
    setMarked(new Set());
    anchor.current = null;
  }, [firstRow]);
  const markedRows = [...marked]
    .sort((a, b) => a - b)
    .flatMap((index) => (rows[index] ? [rows[index]] : []));
  const multiple = markedRows.length > 1;

  function pick(index: number, mode: SelectMode) {
    setMarked((current) => nextMarked(current, anchor.current, index, mode));
    if (mode !== "range" || anchor.current === null) anchor.current = index;
    onSelect(index);
  }

  // Column types are sampled when a result set first arrives, not on every page.
  const hasRows = rows.length > 0;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `rows` is only sampled; `hasRows` marks a new result set.
  const columnDefs = useMemo(() => {
    const defs = columns.map((key) => {
      const kind = dominantKind(rows, key);
      return helper.accessor((row): JsonValue | undefined => row[key], {
        id: key,
        header: key,
        size: columnWidth(key, kind),
        minSize: 64,
        maxSize: 1600,
        meta: { kind },
      });
    });
    return helper.columns(defs);
  }, [columns, hasRows]);

  // Widths the user sets survive new runs of the query: sizing state is keyed by field.
  const table = useTable({
    features,
    columns: columnDefs,
    data: rows as JsonObject[],
    columnResizeMode: "onChange",
  });
  const headers = table.getHeaderGroups()[0]?.headers ?? [];
  const totalWidth = INDEX_WIDTH + table.getTotalSize();
  const resizing = headers.some((header) => header.column.getIsResizing());

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });
  const items = virtualizer.getVirtualItems();
  const lastVisible = items.at(-1)?.index ?? 0;

  useEffect(() => {
    if (hasMore && lastVisible >= rows.length - PREFETCH_ROWS) onLoadMore();
  }, [hasMore, lastVisible, rows.length, onLoadMore]);

  function move(index: number, extend = false) {
    const next = Math.max(0, Math.min(rows.length - 1, index));
    pick(next, extend ? "range" : "replace");
    virtualizer.scrollToIndex(next, { align: "auto" });
  }

  const selected = selectedIndex === null ? undefined : rows[selectedIndex];

  function onKeyDown(event: KeyboardEvent) {
    if (rows.length === 0) return;
    const current = selectedIndex ?? -1;
    const page = Math.floor((scrollRef.current?.clientHeight ?? 300) / ROW_HEIGHT) - 1;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
      event.preventDefault();
      setMarked(new Set(rows.keys()));
      return;
    }
    const handlers: Record<string, () => void> = {
      ArrowDown: () => move(current + 1, event.shiftKey),
      ArrowUp: () => move(current - 1, event.shiftKey),
      Escape: () => selectedIndex !== null && pick(selectedIndex, "replace"),
      PageDown: () => move(current + page),
      PageUp: () => move(current - page),
      Home: () => move(0),
      End: () => move(rows.length - 1),
      Enter: () => selected && onOpen(selected),
      Delete: () =>
        multiple ? actions.onDeleteMany?.(markedRows) : selected && onDelete?.(selected),
      Backspace: () =>
        multiple ? actions.onDeleteMany?.(markedRows) : selected && onDelete?.(selected),
    };
    const handler = handlers[event.key];
    if (handler) {
      event.preventDefault();
      handler();
    }
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild disabled={!selected}>
        <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto">
          <table
            // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: the WAI-ARIA APG data grid pattern is a <table role="grid">.
            role="grid"
            tabIndex={0}
            aria-label={label}
            aria-rowcount={rows.length + 1}
            aria-multiselectable
            aria-activedescendant={selected ? `${gridId}-row-${selectedIndex}` : undefined}
            onKeyDown={onKeyDown}
            className={cn(
              "grid border-collapse outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
              resizing && "cursor-col-resize select-none",
            )}
            style={{ width: totalWidth, minWidth: "100%" }}
          >
            <thead className="sticky top-0 z-10 grid">
              <tr className="flex h-8 border-b bg-sidebar text-muted-foreground text-xs">
                <th
                  aria-label="#"
                  className="sticky left-0 z-20 flex shrink-0 items-center justify-center border-r bg-sidebar"
                  style={{ width: INDEX_WIDTH }}
                >
                  <ColumnsMenu
                    columns={table.getAllLeafColumns()}
                    onShowAll={() => table.toggleAllColumnsVisible(true)}
                  />
                </th>
                {headers.map((header) => {
                  const meta = header.column.columnDef.meta;
                  const sortIndex =
                    columnActions?.sort.findIndex((sort) => sort.field === header.id) ?? -1;
                  const sorted = columnActions?.sort[sortIndex]?.direction ?? null;
                  const multiSort = (columnActions?.sort.length ?? 0) > 1;
                  const label = (
                    <>
                      {meta?.kind && <TypeIcon kind={meta.kind} />}
                      <span className="truncate text-foreground">{header.id}</span>
                      {sorted === 1 && <ArrowUp className="size-3 shrink-0 text-primary" />}
                      {sorted === -1 && <ArrowDown className="size-3 shrink-0 text-primary" />}
                      {sorted !== null && multiSort && (
                        <span className="text-[10px] text-primary tabular-nums">
                          {sortIndex + 1}
                        </span>
                      )}
                    </>
                  );
                  return (
                    <th
                      key={header.id}
                      aria-sort={
                        sorted === 1 ? "ascending" : sorted === -1 ? "descending" : undefined
                      }
                      className="group/header relative flex shrink-0 items-center border-r text-left font-medium"
                      style={{ width: header.getSize() }}
                      title={header.id}
                    >
                      {columnActions ? (
                        // Ascending, descending, then back to the natural order.
                        <button
                          type="button"
                          title={t("column.sortHint", { field: header.id })}
                          className="flex h-full min-w-0 flex-1 items-center gap-1.5 px-2.5 text-left outline-none hover:bg-accent/60 focus-visible:bg-accent"
                          onClick={(event) => columnActions.onSort(header.id, event.shiftKey)}
                        >
                          {label}
                        </button>
                      ) : (
                        <span className="flex min-w-0 flex-1 items-center gap-1.5 px-2.5">
                          {label}
                        </span>
                      )}
                      <div
                        aria-hidden
                        onMouseDown={header.getResizeHandler()}
                        onTouchStart={header.getResizeHandler()}
                        onDoubleClick={() => header.column.resetSize()}
                        className={cn(
                          "absolute top-0 -right-1 z-10 h-full w-2 cursor-col-resize touch-none select-none",
                          "after:absolute after:inset-y-1 after:left-[3px] after:w-0.5 after:rounded-full after:bg-primary after:opacity-0 group-hover/header:after:opacity-40",
                          header.column.getIsResizing() && "after:opacity-100!",
                        )}
                      />
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="relative grid" style={{ height: virtualizer.getTotalSize() }}>
              {items.map((item) => {
                const row = rows[item.index];
                if (!row) return null;
                // The marked rows when there are any; the active row otherwise.
                const isSelected =
                  marked.size > 0 ? marked.has(item.index) : item.index === selectedIndex;
                return (
                  <tr
                    key={item.index}
                    id={`${gridId}-row-${item.index}`}
                    aria-rowindex={item.index + 2}
                    aria-selected={isSelected}
                    onMouseDown={(event) => {
                      // The menu opens only over a selected row, so a right press selects
                      // first, keeping a multiple selection it lands inside.
                      if (event.button === 2) {
                        if (!marked.has(item.index)) pick(item.index, "replace");
                        return;
                      }
                      if (event.button !== 0) return;
                      // Shift-click selects rows, not the text between them.
                      if (event.shiftKey) event.preventDefault();
                      pick(item.index, modeOf(event));
                    }}
                    onContextMenu={(event) => {
                      // Keep a multiple selection when right-clicking inside it.
                      if (!marked.has(item.index)) pick(item.index, "replace");
                      else onSelect(item.index);
                      // Cells set their column first; the row number has none.
                      if (!(event.target as HTMLElement).closest("td")) setMenuColumn(null);
                    }}
                    onDoubleClick={() => onOpen(row)}
                    className={cn(
                      "absolute left-0 flex w-full border-b border-border/60",
                      isSelected ? "bg-selection" : "hover:bg-accent/50",
                    )}
                    style={{ height: ROW_HEIGHT, transform: `translateY(${item.start}px)` }}
                  >
                    <th
                      scope="row"
                      className={cn(
                        "sticky left-0 z-10 flex shrink-0 items-center justify-end border-r pr-2.5 font-mono font-normal text-[11px] text-muted-foreground tabular-nums",
                        // Opaque so cells scrolling underneath stay hidden.
                        isSelected
                          ? "bg-[color-mix(in_oklab,var(--primary)_10%,var(--background))]"
                          : "bg-background",
                      )}
                      style={{ width: INDEX_WIDTH }}
                    >
                      {item.index + 1}
                    </th>
                    {headers.map((header) => (
                      <td
                        key={header.id}
                        onContextMenu={() => setMenuColumn(header.id)}
                        className="flex shrink-0 items-center overflow-hidden border-r border-border/60 px-2.5"
                        style={{ width: header.getSize() }}
                      >
                        <EJsonCell value={row[header.id]} />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </ContextMenuTrigger>
      {selected && (
        <ContextMenuContent className="w-60">
          {multiple ? (
            <>
              <ContextMenuItem
                onSelect={() => {
                  if (actions.onCopyMany) actions.onCopyMany(markedRows);
                }}
              >
                <Copy />
                {t("rows.copy", { count: markedRows.length })}
              </ContextMenuItem>
              {actions.onDeleteMany && (
                <>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    variant="destructive"
                    onSelect={() => actions.onDeleteMany?.(markedRows)}
                  >
                    <Trash2 />
                    {t("rows.delete", { count: markedRows.length })}
                  </ContextMenuItem>
                </>
              )}
            </>
          ) : (
            <>
              {menuColumn !== null && (
                <>
                  <ContextMenuItem
                    disabled={selected[menuColumn] === undefined}
                    onSelect={() => {
                      const value = selected[menuColumn];
                      if (value === undefined) return;
                      void navigator.clipboard.writeText(toShellSyntax(value));
                      toast.success(t("row.copied"));
                    }}
                  >
                    <Copy />
                    <span className="truncate">{t("cell.copy", { field: menuColumn })}</span>
                  </ContextMenuItem>
                  {actions.onEditField && menuColumn !== "_id" && !menuColumn.includes(".") && (
                    <ContextMenuItem onSelect={() => actions.onEditField?.(selected, menuColumn)}>
                      <PencilLine />
                      <span className="truncate">{t("cell.edit", { field: menuColumn })}</span>
                    </ContextMenuItem>
                  )}
                  {columnActions && (
                    <ContextMenuItem
                      onSelect={() => columnActions.onFilterBy(menuColumn, selected[menuColumn])}
                    >
                      <Filter />
                      <span className="truncate">{t("cell.filter", { field: menuColumn })}</span>
                    </ContextMenuItem>
                  )}
                  {columnActions?.onDistinct && (
                    <ContextMenuItem onSelect={() => columnActions.onDistinct?.(menuColumn)}>
                      <ListChecks />
                      <span className="truncate">{t("cell.distinct", { field: menuColumn })}</span>
                    </ContextMenuItem>
                  )}
                  <ContextMenuSeparator />
                </>
              )}
              <RowMenuItems row={selected} actions={actions} />
            </>
          )}
        </ContextMenuContent>
      )}
    </ContextMenu>
  );
}

interface ToggleableColumn {
  id: string;
  getIsVisible: () => boolean;
  toggleVisibility: (value?: boolean) => void;
}

/** Shows or hides columns; at least one stays visible. */
function ColumnsMenu({
  columns,
  onShowAll,
}: {
  columns: readonly ToggleableColumn[];
  onShowAll: () => void;
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
        {visible < columns.length && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onShowAll}>{t("columns.showAll")}</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
