/**
 * Scores `text` against `query`, higher is better, `null` for no match:
 * prefix > word prefix > substring > letters in order (`usr` finds `users`).
 */
export function matchScore(text: string, query: string): number | null {
  const haystack = text.toLowerCase();
  const needle = query.trim().toLowerCase();
  if (needle === "") return 0;
  if (haystack.startsWith(needle)) return 400 - haystack.length / 100;
  const index = haystack.indexOf(needle);
  if (index > 0 && /[\s._\-/]/.test(haystack[index - 1] ?? "")) return 300 - index / 100;
  if (index >= 0) return 200 - index / 100;
  let position = 0;
  for (const char of needle) {
    position = haystack.indexOf(char, position);
    if (position === -1) return null;
    position += 1;
  }
  return 100 - position / 100;
}

/** The best `limit` items for `query`, best first; ties keep their order. */
export function rankMatches<T>(
  items: readonly T[],
  query: string,
  textOf: (item: T) => string,
  limit: number,
): T[] {
  return items
    .map((item, order) => ({ item, order, score: matchScore(textOf(item), query) }))
    .filter((entry): entry is { item: T; order: number; score: number } => entry.score !== null)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, limit)
    .map((entry) => entry.item);
}
