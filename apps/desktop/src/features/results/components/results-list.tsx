import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@odin-db/ui/components/context-menu";
import { useVirtualizer } from "@tanstack/react-virtual";
import { type KeyboardEvent, useEffect, useId, useRef } from "react";
import type { JsonObject } from "@/lib/ejson-display";
import { DocumentCard } from "./document-card";
import type { FindTarget, RowActions } from "./results-grid";
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
  /** The current Find match: its document scrolled into view, its field marked. */
  findCurrent?: FindTarget | null | undefined;
}

/** Frames to wait for a document scrolled to to render. */
const RENDER_FRAMES = 10;

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
  findCurrent,
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new match (`seq`) is the trigger.
  useEffect(() => {
    if (!findCurrent) return;
    const { row, field } = findCurrent;
    virtualizer.scrollToIndex(row, { align: "auto" });
    // Cards are measured as they render: mark the field once the card is there, then bring
    // the field itself into view (a long document may be taller than the list).
    let frames = 0;
    let frame = requestAnimationFrame(function mark() {
      const list = scrollRef.current;
      const card = list?.querySelector(`[data-index="${row}"]`);
      if (!list || !card) {
        if (++frames < RENDER_FRAMES) frame = requestAnimationFrame(mark);
        return;
      }
      for (const old of list.querySelectorAll("[data-find-current]")) {
        old.removeAttribute("data-find-current");
      }
      // Trees mark the field's line; JSON text marks the whole document.
      const target = card.querySelector(`[data-path="${CSS.escape(field)}"]`) ?? card;
      target.setAttribute("data-find-current", "");
      target.scrollIntoView({ block: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [findCurrent?.seq]);

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
