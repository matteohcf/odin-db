import { useEffect } from "react";

/**
 * Marks every occurrence of `query` in the text rendered inside `element`, through the CSS
 * Custom Highlight API, so no cell or tree renders differently. Rows scroll in and out of a
 * virtualized view, so the marks are redrawn whenever the DOM changes. Text inside an element
 * with `data-find-current` gets the stronger `find-current` mark. Without the API (older
 * WebKitGTK) nothing is marked; moving between matches still works.
 */
export function useFindHighlight(element: HTMLElement | null, query: string, enabled: boolean) {
  useEffect(() => {
    const needle = query.trim().toLowerCase();
    if (!enabled || !element || !needle || typeof CSS === "undefined" || !CSS.highlights) return;
    let frame = 0;
    const paint = () => {
      frame = 0;
      const all: Range[] = [];
      const current: Range[] = [];
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.nodeValue?.toLowerCase() ?? "";
        let at = text.indexOf(needle);
        if (at < 0) continue;
        const target = node.parentElement?.closest("[data-find-current]") ? current : all;
        while (at >= 0) {
          const range = new Range();
          range.setStart(node, at);
          range.setEnd(node, at + needle.length);
          target.push(range);
          at = text.indexOf(needle, at + needle.length);
        }
      }
      CSS.highlights.set("find", new Highlight(...all));
      CSS.highlights.set("find-current", new Highlight(...current));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };
    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(element, {
      subtree: true,
      childList: true,
      characterData: true,
      attributeFilter: ["data-find-current"],
    });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      CSS.highlights.delete("find");
      CSS.highlights.delete("find-current");
    };
  }, [element, query, enabled]);
}
