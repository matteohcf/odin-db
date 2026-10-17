import { Button } from "@odin-db/ui/components/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@odin-db/ui/components/context-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@odin-db/ui/components/tooltip";
import { cn } from "@odin-db/ui/lib/utils";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronsDownUp, ChevronsUpDown, Copy, Eye, Pencil, Trash2 } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { JsonObject } from "@/lib/ejson-display";
import { DocumentTree } from "./document-tree";
import { JsonDocument } from "./json-document";
import type { RowActions } from "./results-grid";
import { RowMenuItems } from "./row-menu-items";

/** Start fetching the next page this many documents before the end. */
const PREFETCH_ROWS = 10;

interface ResultsListProps {
  /** Expandable field trees, or the documents as text. */
  format: "tree" | "json";
  label: string;
  rows: readonly JsonObject[];
  hasMore: boolean;
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  onLoadMore: () => void;
  actions: RowActions;
}

/**
 * Documents as expandable trees, one card each. Cards have different heights,
 * so the virtualizer measures them as they render.
 */
export function ResultsList({
  format,
  label,
  rows,
  hasMore,
  selectedIndex,
  onSelect,
  onLoadMore,
  actions,
}: ResultsListProps) {
  const listId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    // Roughly one line per top-level field; measured precisely once rendered.
    estimateSize: (index) => Object.keys(rows[index] ?? {}).length * 20 + 26,
    // Switching between trees and text changes every card's height.
    getItemKey: (index) => `${format}-${index}`,
    overscan: 4,
    gap: 8,
  });
  const items = virtualizer.getVirtualItems();
  const lastVisible = items.at(-1)?.index ?? 0;

  useEffect(() => {
    if (hasMore && lastVisible >= rows.length - PREFETCH_ROWS) onLoadMore();
  }, [hasMore, lastVisible, rows.length, onLoadMore]);

  const selected = selectedIndex === null ? undefined : rows[selectedIndex];

  function move(index: number) {
    const next = Math.max(0, Math.min(rows.length - 1, index));
    onSelect(next);
    virtualizer.scrollToIndex(next, { align: "auto" });
  }

  function onKeyDown(event: KeyboardEvent) {
    if (rows.length === 0 || event.target !== event.currentTarget) return;
    const current = selectedIndex ?? -1;
    const handlers: Record<string, () => void> = {
      ArrowDown: () => move(current + 1),
      ArrowUp: () => move(current - 1),
      Home: () => move(0),
      End: () => move(rows.length - 1),
      Enter: () => selected && actions.onOpen(selected),
      Delete: () => selected && actions.onDelete?.(selected),
      Backspace: () => selected && actions.onDelete?.(selected),
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
        <div
          ref={scrollRef}
          role="listbox"
          tabIndex={0}
          aria-label={label}
          aria-activedescendant={selected ? `${listId}-${selectedIndex}` : undefined}
          onKeyDown={onKeyDown}
          className="relative min-h-0 flex-1 overflow-auto bg-muted/30 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          <div className="relative mx-3 my-3" style={{ height: virtualizer.getTotalSize() }}>
            {items.map((item) => {
              const row = rows[item.index];
              if (!row) return null;
              return (
                <div
                  key={item.key}
                  ref={virtualizer.measureElement}
                  data-index={item.index}
                  className="absolute top-0 left-0 w-full"
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  <DocumentCard
                    format={format}
                    id={`${listId}-${item.index}`}
                    row={row}
                    selected={item.index === selectedIndex}
                    onSelect={() => onSelect(item.index)}
                    actions={actions}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </ContextMenuTrigger>
      {selected && (
        <ContextMenuContent className="w-52">
          <RowMenuItems row={selected} actions={actions} />
        </ContextMenuContent>
      )}
    </ContextMenu>
  );
}

function DocumentCard({
  format,
  id,
  row,
  selected,
  onSelect,
  actions,
}: {
  format: "tree" | "json";
  id: string;
  row: JsonObject;
  selected: boolean;
  onSelect: () => void;
  actions: RowActions;
}) {
  const { t } = useTranslation("results");
  const [expanded, setExpanded] = useState(false);
  const setField = actions.onSetField;
  // Remounting the tree applies "expand all" to every nested field.
  const [treeKey, setTreeKey] = useState(0);

  return (
    // biome-ignore lint/a11y/useFocusableInteractive: focus stays on the listbox, which announces the selected option.
    <div
      id={id}
      role="option"
      aria-selected={selected}
      onMouseDown={onSelect}
      onContextMenu={onSelect}
      onDoubleClick={(event) => {
        // Double-clicking a field toggle should not open the editor.
        if ((event.target as HTMLElement).closest("button")) return;
        actions.onOpen(row);
      }}
      className={cn(
        "group relative rounded-md border bg-background px-2 py-1.5 shadow-xs",
        selected ? "border-primary/60 ring-1 ring-primary/30" : "hover:border-border/80",
      )}
    >
      <div className="absolute top-1.5 right-1.5 flex items-center gap-0.5 rounded-md bg-background opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        {format === "tree" && (
          <CardAction
            label={expanded ? t("view.collapseAll") : t("view.expandAll")}
            onClick={() => {
              setExpanded((value) => !value);
              setTreeKey((value) => value + 1);
            }}
          >
            {expanded ? <ChevronsDownUp /> : <ChevronsUpDown />}
          </CardAction>
        )}
        <CardAction label={t("row.copy")} onClick={() => actions.onCopy(row)}>
          <Copy />
        </CardAction>
        <CardAction
          label={actions.openMode === "view" ? t("row.view") : t("row.edit")}
          onClick={() => actions.onOpen(row)}
        >
          {actions.openMode === "view" ? <Eye /> : <Pencil />}
        </CardAction>
        {actions.onDelete && (
          <CardAction
            label={t("row.delete")}
            onClick={() => actions.onDelete?.(row)}
            className="hover:text-destructive"
          >
            <Trash2 />
          </CardAction>
        )}
      </div>
      {format === "tree" ? (
        <DocumentTree
          key={treeKey}
          document={row}
          expanded={expanded}
          onSetField={setField && ((field, value) => setField(row, field, value))}
        />
      ) : (
        <JsonDocument document={row} />
      )}
    </div>
  );
}

function CardAction({
  label,
  onClick,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={label}
          onClick={onClick}
          onMouseDown={(event) => event.stopPropagation()}
          className={cn("size-6 text-muted-foreground [&_svg]:size-3.5", className)}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
