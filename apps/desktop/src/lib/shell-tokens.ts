/** Token kinds for highlighting mongosh syntax without a full editor. */
export type ShellTokenKind =
  | "string"
  | "number"
  | "keyword"
  | "constructor"
  | "key"
  | "punctuation"
  | "text";

export interface ShellToken {
  kind: ShellTokenKind;
  text: string;
}

// Order matters: strings first so their content is never re-tokenized.
const TOKEN =
  /("(?:[^"\\]|\\.)*")(\s*:)?|(\/(?:[^/\\\n]|\\.)+\/[a-z]*)|(-?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b|NaN|-?Infinity)|\b(true|false|null)\b|\b([A-Z][A-Za-z0-9]*)(?=\()|([A-Za-z_$][\w$]*)(?=\s*:)|([{}[\](),:])/g;

/** Splits text written by `toShellSyntax` into highlightable tokens. */
export function shellTokens(text: string): ShellToken[] {
  const tokens: ShellToken[] = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    const index = match.index ?? 0;
    if (index > last) tokens.push({ kind: "text", text: text.slice(last, index) });
    const [whole, string, colon, regex, number, keyword, ctor, key, punct] = match;
    if (string !== undefined) {
      tokens.push({ kind: colon ? "key" : "string", text: string });
      if (colon) tokens.push({ kind: "punctuation", text: colon });
    } else if (regex !== undefined) tokens.push({ kind: "string", text: regex });
    else if (number !== undefined) tokens.push({ kind: "number", text: number });
    else if (keyword !== undefined) tokens.push({ kind: "keyword", text: keyword });
    else if (ctor !== undefined) tokens.push({ kind: "constructor", text: ctor });
    else if (key !== undefined) tokens.push({ kind: "key", text: key });
    else if (punct !== undefined) tokens.push({ kind: "punctuation", text: punct });
    else tokens.push({ kind: "text", text: whole });
    last = index + whole.length;
  }
  if (last < text.length) tokens.push({ kind: "text", text: text.slice(last) });
  return tokens;
}
