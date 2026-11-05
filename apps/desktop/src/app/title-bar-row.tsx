/**
 * An empty row where macOS draws the title bar over the content (ADR-0062): it holds
 * the traffic lights at the top of the sidebar, and moves the window from its empty
 * space. Level with the tab bar.
 */
export function TitleBarRow() {
  return (
    <div
      data-tauri-drag-region="deep"
      data-testid="title-bar-row"
      className="h-9 shrink-0 border-b bg-sidebar"
    />
  );
}
