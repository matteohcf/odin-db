import { javascript } from "@codemirror/lang-javascript";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { cn } from "@odin-db/ui/lib/utils";
import { basicSetup } from "codemirror";
import { useEffect, useRef } from "react";

// Colors come from the design tokens, so the editor follows light/dark automatically.
const theme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "12.5px",
    backgroundColor: "var(--background)",
    color: "var(--foreground)",
  },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.55" },
  ".cm-gutters": {
    backgroundColor: "var(--background)",
    color: "var(--muted-foreground)",
    border: "none",
  },
  ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "var(--muted)" },
  "&.cm-focused": { outline: "none" },
  ".cm-cursor": { borderLeftColor: "var(--primary)" },
  "&.cm-focused .cm-matchingBracket": { backgroundColor: "var(--selection)", outline: "none" },
  ".cm-foldPlaceholder": {
    backgroundColor: "var(--muted)",
    border: "none",
    color: "var(--muted-foreground)",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--selection) !important",
  },
});

// The same hues as grid cells: a string, a number or an id looks alike everywhere.
const highlight = HighlightStyle.define([
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: "var(--type-string)" },
  { tag: [tags.number], color: "var(--type-number)" },
  { tag: [tags.bool, tags.null, tags.keyword], color: "var(--type-boolean)" },
  { tag: [tags.function(tags.variableName)], color: "var(--type-object-id)" },
  { tag: [tags.propertyName, tags.definition(tags.propertyName)], color: "var(--foreground)" },
  { tag: [tags.comment], color: "var(--muted-foreground)", fontStyle: "italic" },
  { tag: [tags.punctuation, tags.bracket, tags.separator], color: "var(--muted-foreground)" },
]);

export interface CodeEditorProps {
  initialValue: string;
  onChange?: (value: string) => void;
  /** Bound to Mod-Enter. */
  onSubmit?: () => void;
  readOnly?: boolean;
  autoFocus?: boolean;
  className?: string;
  ariaLabel: string;
}

/**
 * CodeMirror in mongosh (JavaScript) mode. Uncontrolled: `initialValue` seeds the
 * document once; remount with a `key` to load different content.
 */
/** Loaded lazily through `code-editor.tsx`: CodeMirror is a large chunk. */
export default function CodeEditorView({
  initialValue,
  onChange,
  onSubmit,
  readOnly = false,
  autoFocus = false,
  className,
  ariaLabel,
}: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  // Latest callbacks without recreating the editor on every render.
  const callbacks = useRef({ onChange, onSubmit });
  callbacks.current = { onChange, onSubmit };
  const initial = useRef({ initialValue, readOnly, autoFocus, ariaLabel });

  useEffect(() => {
    if (!hostRef.current) return;
    const { initialValue, readOnly, autoFocus, ariaLabel } = initial.current;
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: initialValue,
        extensions: [
          keymap.of([
            {
              key: "Mod-Enter",
              run: () => {
                callbacks.current.onSubmit?.();
                return true;
              },
            },
          ]),
          basicSetup,
          javascript(),
          syntaxHighlighting(highlight),
          theme,
          EditorState.readOnly.of(readOnly),
          EditorView.contentAttributes.of({ "aria-label": ariaLabel }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) callbacks.current.onChange?.(update.state.doc.toString());
          }),
        ],
      }),
    });
    if (autoFocus) view.focus();
    return () => view.destroy();
  }, []);

  return <div ref={hostRef} className={cn("min-h-0 overflow-hidden", className)} />;
}
