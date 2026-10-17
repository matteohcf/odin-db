import { memo, useMemo } from "react";
import type { JsonObject } from "@/lib/ejson-display";
import { toShellSyntax } from "@/lib/shell-syntax";
import { type ShellTokenKind, shellTokens } from "@/lib/shell-tokens";

// The same hues as grid cells and editors.
const TOKEN_CLASS: Record<ShellTokenKind, string | undefined> = {
  string: "text-[var(--type-string)]",
  number: "text-[var(--type-number)]",
  keyword: "text-[var(--type-boolean)]",
  constructor: "text-[var(--type-object-id)]",
  key: "text-foreground",
  punctuation: "text-muted-foreground",
  text: undefined,
};

/** A document as highlighted mongosh text, the format the editor uses. */
export const JsonDocument = memo(function JsonDocument({ document }: { document: JsonObject }) {
  const tokens = useMemo(() => shellTokens(toShellSyntax(document)), [document]);
  return (
    <pre className="overflow-x-auto font-mono text-[length:var(--editor-font-size,12.5px)] leading-5 selectable">
      {tokens.map((token, index) => (
        // Tokens of one immutable document, replaced as a whole.
        <span key={index} className={TOKEN_CLASS[token.kind]}>
          {token.text}
        </span>
      ))}
    </pre>
  );
});
