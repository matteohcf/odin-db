import type { JsonValue } from "@odin-db/bindings";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@odin-db/ui/components/context-menu";
import { cn } from "@odin-db/ui/lib/utils";
import { createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Copy, CopyPlus, Eye, Pencil, Trash2 } from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { EJsonCell } from "@/components/ejson-cell";
import { TypeIcon } from "@/components/type-icon";
import type { JsonObject } from "@/lib/ejson-display";
import { columnWidth, dominantKind } from "../lib/columns";

const ROW_HEIGHT = 30;
const INDEX_WIDTH = 56;
/** Start fetching the next page this many rows before the end. */
const PREFETCH_ROWS = 40;

const features = tableFeatures({});
const helper = createColumnHelper<typeof features, JsonObject>();

interface ResultsGridProps {
  label: string;
  rows: readonly JsonObject[];
  columns: readonly string[];
  hasMore: boolean;
  readOnly: boolean;
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  onLoadMore: () => void;
  onOpen: (row: JsonObject) => void;
  onDuplicate: (row: JsonObject) => void;
  onCopy: (row: JsonObject) => void;
  onDelete: (row: JsonObject) => void;
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
  readOnly,
  selectedIndex,
  onSelect,
  onLoadMore,
  onOpen,
  onDuplicate,
  onCopy,
  onDelete,
}: ResultsGridProps) {
  const { t } = useTranslation("documents");
  const gridId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Column types are sampled when a result set first arrives, not on every page.
  const hasRows = rows.length > 0;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `rows` is only sampled; `hasRows` marks a new result set.
  const columnDefs = useMemo(() => {
    const defs = columns.map((key) => {
      const kind = dominantKind(rows, key);
      return helper.accessor((row): JsonValue | undefined => row[key], {
        id: key,
        header: key,
        meta: { kind, width: columnWidth(key, kind) },
      });
    });
    return helper.columns(defs);
  }, [columns, hasRows]);

  const table = useTable({ features, columns: columnDefs, data: rows as JsonObject[] });
  const headers = table.getHeaderGroups()[0]?.headers ?? [];
  const totalWidth =
    INDEX_WIDTH + headers.reduce((sum, header) => sum + widthOf(header.column.columnDef.meta), 0);

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

  function move(index: number) {
    const next = Math.max(0, Math.min(rows.length - 1, index));
    onSelect(next);
    virtualizer.scrollToIndex(next, { align: "auto" });
  }

  const selected = selectedIndex === null ? undefined : rows[selectedIndex];

  function onKeyDown(event: KeyboardEvent) {
    if (rows.length === 0) return;
    const current = selectedIndex ?? -1;
    const page = Math.floor((scrollRef.current?.clientHeight ?? 300) / ROW_HEIGHT) - 1;
    const handlers: Record<string, () => void> = {
      ArrowDown: () => move(current + 1),
      ArrowUp: () => move(current - 1),
      PageDown: () => move(current + page),
      PageUp: () => move(current - page),
      Home: () => move(0),
      End: () => move(rows.length - 1),
      Enter: () => selected && onOpen(selected),
      Delete: () => selected && !readOnly && onDelete(selected),
      Backspace: () => selected && !readOnly && onDelete(selected),
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
            aria-activedescendant={selected ? `${gridId}-row-${selectedIndex}` : undefined}
            onKeyDown={onKeyDown}
            className="grid border-collapse outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            style={{ width: totalWidth, minWidth: "100%" }}
          >
            <thead className="sticky top-0 z-10 grid">
              <tr className="flex h-8 border-b bg-sidebar text-muted-foreground text-xs">
                <th
                  aria-label="#"
                  className="sticky left-0 shrink-0 border-r bg-sidebar"
                  style={{ width: INDEX_WIDTH }}
                />
                {headers.map((header) => {
                  const meta = header.column.columnDef.meta;
                  return (
                    <th
                      key={header.id}
                      className="flex shrink-0 items-center gap-1.5 border-r px-2.5 text-left font-medium"
                      style={{ width: widthOf(meta) }}
                      title={header.id}
                    >
                      {meta?.kind && <TypeIcon kind={meta.kind} />}
                      <span className="truncate text-foreground">{header.id}</span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="relative grid" style={{ height: virtualizer.getTotalSize() }}>
              {items.map((item) => {
                const row = rows[item.index];
                if (!row) return null;
                const isSelected = item.index === selectedIndex;
                return (
                  <tr
                    key={item.index}
                    id={`${gridId}-row-${item.index}`}
                    aria-rowindex={item.index + 2}
                    aria-selected={isSelected}
                    onMouseDown={() => onSelect(item.index)}
                    onContextMenu={() => onSelect(item.index)}
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
                        "sticky left-0 flex shrink-0 items-center justify-end border-r pr-2.5 font-mono font-normal text-[11px] text-muted-foreground tabular-nums",
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
                        className="flex shrink-0 items-center overflow-hidden border-r border-border/60 px-2.5"
                        style={{ width: widthOf(header.column.columnDef.meta) }}
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
        <ContextMenuContent className="w-52">
          <ContextMenuItem onSelect={() => onOpen(selected)}>
            {readOnly ? <Eye /> : <Pencil />}
            {readOnly ? t("row.view") : t("row.edit")}
          </ContextMenuItem>
          {!readOnly && (
            <ContextMenuItem onSelect={() => onDuplicate(selected)}>
              <CopyPlus />
              {t("row.duplicate")}
            </ContextMenuItem>
          )}
          <ContextMenuItem onSelect={() => onCopy(selected)}>
            <Copy />
            {t("row.copy")}
          </ContextMenuItem>
          {!readOnly && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem variant="destructive" onSelect={() => onDelete(selected)}>
                <Trash2 />
                {t("row.delete")}
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      )}
    </ContextMenu>
  );
}

function widthOf(meta: { width: number } | undefined): number {
  return meta?.width ?? 200;
}
