import {
  acceptCompletion,
  autocompletion,
  type CompletionSource,
  closeBrackets,
  closeBracketsKeymap,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { javascriptLanguage } from "@codemirror/lang-javascript";
import { LanguageSupport, syntaxHighlighting } from "@codemirror/language";
import { EditorState, Prec } from "@codemirror/state";
import { drawSelection, EditorView, keymap, placeholder } from "@codemirror/view";
import { cn } from "@odin-db/ui/lib/utils";
import { useEffect, useRef } from "react";
import { completionTheme } from "@/lib/codemirror-completion-theme";
import { highlight } from "@/lib/codemirror-highlight";
import { reopensCompletion } from "@/lib/query-completion";

// A query is one expression, not a script: `{ a: 1 }` is an object, not a block.
const queryLanguage = new LanguageSupport(
  javascriptLanguage.configure({ top: "SingleExpression" }),
);

/** Newlines (typed or pasted) become spaces: the editor is a single line. */
const singleLine = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || tr.newDoc.lines === 1) return tr;
  const text = tr.newDoc.toString().replace(/\s*\n\s*/g, " ");
  return [tr, { changes: { from: 0, to: tr.newDoc.length, insert: text }, sequential: true }];
});

const theme = EditorView.theme({
  "&": {
    flex: "1",
    minWidth: "0",
    height: "100%",
    fontSize: "12px",
    backgroundColor: "transparent",
    color: "var(--foreground)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
    lineHeight: "30px",
    overflowX: "auto",
    overflowY: "hidden",
    scrollbarWidth: "none",
  },
  ".cm-content": { padding: "0", caretColor: "var(--primary)" },
  ".cm-line": { padding: "0 10px 0 0" },
  ".cm-cursor": { borderLeftColor: "var(--primary)" },
  ".cm-placeholder": { color: "var(--muted-foreground)", opacity: "0.6" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--selection) !important",
  },
});

export interface QueryEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** Enter (when no suggestion is open) and Mod-Enter. */
  onSubmit: () => void;
  completions?: CompletionSource;
  placeholder?: string;
  ariaLabel: string;
  invalid?: boolean;
  autoFocus?: boolean;
  className?: string;
}

/** A single-line mongosh editor with autocompletion, for query bar fields. */
export default function QueryEditorView({
  value,
  onChange,
  onSubmit,
  completions,
  placeholder: placeholderText = "",
  ariaLabel,
  invalid = false,
  autoFocus = false,
  className,
}: QueryEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const callbacks = useRef({ onChange, onSubmit });
  callbacks.current = { onChange, onSubmit };
  const initial = useRef({ value, completions, placeholderText, ariaLabel, autoFocus });

  useEffect(() => {
    if (!hostRef.current) return;
    const { value, completions, placeholderText, ariaLabel, autoFocus } = initial.current;
    const submit = () => {
      callbacks.current.onSubmit();
      return true;
    };
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          drawSelection(),
          closeBrackets(),
          autocompletion({
            override: completions ? [completions] : [],
            icons: false,
            maxRenderedOptions: 200,
            activateOnCompletion: reopensCompletion,
          }),
          Prec.high(
            keymap.of([
              { key: "Tab", run: acceptCompletion },
              // Enter runs the query unless a suggestion is open (the completion keymap wins then).
              { key: "Enter", run: submit },
              { key: "Mod-Enter", run: submit },
            ]),
          ),
          keymap.of([...closeBracketsKeymap, ...historyKeymap, ...defaultKeymap]),
          queryLanguage,
          syntaxHighlighting(highlight),
          theme,
          completionTheme,
          singleLine,
          placeholder(placeholderText),
          EditorView.contentAttributes.of({
            "aria-label": ariaLabel,
            spellcheck: "false",
            autocapitalize: "off",
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) callbacks.current.onChange(update.state.doc.toString());
          }),
        ],
      }),
    });
    viewRef.current = view;
    if (autoFocus) view.focus();
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  // Controlled: apply outside changes (history, reset) without disturbing typing.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
      selection: { anchor: value.length },
    });
  }, [value]);

  useEffect(() => {
    viewRef.current?.contentDOM.setAttribute("aria-invalid", String(invalid));
  }, [invalid]);

  return <div ref={hostRef} className={cn("flex h-full min-w-0", className)} />;
}
