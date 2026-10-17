import { HighlightStyle } from "@codemirror/language";
import { tags } from "@lezer/highlight";

// The same hues as grid cells: a string, a number or an id looks alike everywhere.
export const highlight = HighlightStyle.define([
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: "var(--type-string)" },
  { tag: [tags.number], color: "var(--type-number)" },
  { tag: [tags.bool, tags.null, tags.keyword], color: "var(--type-boolean)" },
  { tag: [tags.function(tags.variableName)], color: "var(--type-object-id)" },
  { tag: [tags.propertyName, tags.definition(tags.propertyName)], color: "var(--foreground)" },
  { tag: [tags.comment], color: "var(--muted-foreground)", fontStyle: "italic" },
  { tag: [tags.punctuation, tags.bracket, tags.separator], color: "var(--muted-foreground)" },
]);
