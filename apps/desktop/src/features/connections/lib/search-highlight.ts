/**
 * The search as a JavaScript pattern, to mark matches in results. Core matches with Rust's
 * regex syntax; the rare pattern JavaScript cannot read just goes unmarked.
 */
export function searchPattern(search: {
  text: string;
  regex: boolean;
  caseSensitive: boolean;
}): RegExp | null {
  const text = search.text.trim();
  if (text === "") return null;
  const source = search.regex ? text : text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  try {
    return new RegExp(source, search.caseSensitive ? "g" : "gi");
  } catch {
    return null;
  }
}

/** `text` cut into plain and matching parts, in order. */
export function highlightParts(
  text: string,
  pattern: RegExp | null,
): { text: string; match: boolean }[] {
  if (!pattern) return [{ text, match: false }];
  const parts: { text: string; match: boolean }[] = [];
  let last = 0;
  for (const found of text.matchAll(pattern)) {
    const start = found.index;
    // An empty match (e.g. `a*`) marks nothing and would loop forever.
    if (found[0] === "") continue;
    if (start > last) parts.push({ text: text.slice(last, start), match: false });
    parts.push({ text: found[0], match: true });
    last = start + found[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), match: false });
  return parts;
}
