import { EditorView } from "@codemirror/view";

/** Suggestion lists styled like the app's popovers, shared by every editor. */
export const completionTheme = EditorView.theme({
  ".cm-tooltip": {
    backgroundColor: "var(--popover)",
    color: "var(--popover-foreground)",
    border: "1px solid var(--border)",
    borderRadius: "calc(var(--radius) + 2px)",
    boxShadow: "0 8px 24px -8px rgb(0 0 0 / 0.25)",
    overflow: "hidden",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul": {
    fontFamily: "var(--font-mono)",
    fontSize: "12px",
    maxHeight: "20rem",
    minWidth: "18rem",
    maxWidth: "32rem",
    padding: "4px",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li": {
    display: "flex",
    alignItems: "baseline",
    padding: "3px 8px",
    borderRadius: "4px",
    lineHeight: "1.5",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--accent)",
    color: "var(--accent-foreground)",
  },
  ".cm-completionMatchedText": {
    textDecoration: "none",
    color: "var(--primary)",
    fontWeight: "600",
  },
  ".cm-completionDetail": {
    marginLeft: "auto",
    paddingLeft: "1.5em",
    fontStyle: "normal",
    fontFamily: "var(--font-sans)",
    fontSize: "11px",
    color: "var(--muted-foreground)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > completion-section": {
    display: "block",
    padding: "6px 8px 2px",
    border: "none",
    opacity: "1",
    fontFamily: "var(--font-sans)",
    fontSize: "10.5px",
    fontWeight: "500",
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: "var(--muted-foreground)",
  },
});
