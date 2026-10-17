export type SelectMode = "replace" | "toggle" | "range";

/**
 * Rows marked after a click, like a file manager: a plain click selects one
 * row, Cmd/Ctrl adds or removes one, Shift selects from the anchor.
 */
export function nextMarked(
  marked: ReadonlySet<number>,
  anchor: number | null,
  index: number,
  mode: SelectMode,
): Set<number> {
  if (mode === "replace" || anchor === null) return new Set([index]);
  if (mode === "toggle") {
    const next = new Set(marked.size > 0 ? marked : [anchor]);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    return next;
  }
  const [from, to] = anchor <= index ? [anchor, index] : [index, anchor];
  return new Set(Array.from({ length: to - from + 1 }, (_, offset) => from + offset));
}

export const modeOf = (event: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) =>
  event.shiftKey ? "range" : event.metaKey || event.ctrlKey ? "toggle" : "replace";
