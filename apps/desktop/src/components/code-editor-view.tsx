import { autocompletion, type CompletionSource } from "@codemirror/autocomplete";
import { javascript } from "@codemirror/lang-javascript";
import { syntaxHighlighting } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { cn } from "@odin-db/ui/lib/utils";
import { basicSetup } from "codemirror";
import { useEffect, useRef } from "react";
import { completionTheme } from "@/lib/codemirror-completion-theme";
import { highlight } from "@/lib/codemirror-highlight";
import { submitOnKeybinding } from "@/lib/editor-keybindings";
import { closeCompletionWhenBlurred, reopensCompletion } from "@/lib/query-completion";

// Colors come from the design tokens, so the editor follows light/dark automatically.
const theme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "var(--editor-font-size, 12.5px)",
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

export interface CodeEditorProps {
  initialValue: string;
  onChange?: (value: string) => void;
  /** Bound to the "run / save" shortcut. */
  onSubmit?: () => void;
  readOnly?: boolean;
  autoFocus?: boolean;
  /** Replaces the JavaScript suggestions, e.g. with MongoDB-aware ones. */
  completions?: CompletionSource;
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
  completions,
}: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  // Latest callbacks without recreating the editor on every render.
  const callbacks = useRef({ onChange, onSubmit });
  callbacks.current = { onChange, onSubmit };
  const initial = useRef({ initialValue, readOnly, autoFocus, ariaLabel, completions });

  useEffect(() => {
    if (!hostRef.current) return;
    const { initialValue, readOnly, autoFocus, ariaLabel, completions } = initial.current;
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: initialValue,
        extensions: [
          submitOnKeybinding(() => callbacks.current.onSubmit?.()),
          basicSetup,
          javascript(),
          completions
            ? autocompletion({
                override: [completions],
                icons: false,
                activateOnCompletion: reopensCompletion,
              })
            : [],
          closeCompletionWhenBlurred,
          completionTheme,
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
