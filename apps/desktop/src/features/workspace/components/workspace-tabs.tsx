import { type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useTabShortcuts } from "../hooks/use-tab-shortcuts";
import { useTabs, type WorkspaceTab } from "../store/tabs-store";
import { TabItem } from "./tab-item";
import { TabPanel } from "./tab-panel";
import { TabsOverflowMenu } from "./tabs-overflow-menu";

export interface TabLabelContext {
  /** Tabs from more than one connection are open, so labels must say which. */
  showsSeveralConnections: boolean;
}

interface WorkspaceTabsProps {
  /** Renders a tab's content. Supplied by the app so the workspace knows no feature. */
  renderTab: (tab: WorkspaceTab) => ReactNode;
  renderLabel: (tab: WorkspaceTab, context: TabLabelContext) => ReactNode;
  emptyState: ReactNode;
}

/**
 * Tab bar plus panels. Inactive panels stay mounted (hidden) so each tab keeps its
 * query, results and open cursor while the user switches around.
 */
export function WorkspaceTabs({ renderTab, renderLabel, emptyState }: WorkspaceTabsProps) {
  const { t } = useTranslation("workspace");
  const tabs = useTabs((s) => s.tabs);
  const activeTabId = useTabs((s) => s.activeTabId);
  const [dragging, setDragging] = useState<string | null>(null);
  const tabList = useRef<HTMLDivElement>(null);
  useTabShortcuts();

  // Past the edge of the bar, tabs are listed in a menu at its end.
  const [overflowing, setOverflowing] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: new tabs need observing too.
  useEffect(() => {
    const bar = tabList.current;
    if (!bar) return;
    const update = () => {
      setOverflowing(bar.scrollWidth > bar.clientWidth + 1);
      // Ends hiding tabs fade out instead of cutting a label off. Set on the element directly:
      // scrolling must not re-render every tab.
      const start = bar.scrollLeft > 1 ? "transparent" : "black";
      const end = bar.scrollLeft + bar.clientWidth < bar.scrollWidth - 1 ? "transparent" : "black";
      bar.style.maskImage = `linear-gradient(to right, ${start}, black 28px, black calc(100% - 28px), ${end})`;
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(bar);
    for (const child of bar.children) observer.observe(child);
    bar.addEventListener("scroll", update, { passive: true });
    return () => {
      observer.disconnect();
      bar.removeEventListener("scroll", update);
    };
  }, [tabs]);

  // A tab opened from the sidebar or the palette may sit past the edge of a long tab bar.
  useEffect(() => {
    if (!activeTabId) return;
    tabList.current
      ?.querySelector(`[data-tab-id="${CSS.escape(activeTabId)}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeTabId]);

  if (tabs.length === 0) return <>{emptyState}</>;
  const context: TabLabelContext = {
    showsSeveralConnections:
      new Set(tabs.flatMap((tab) => ("profileId" in tab ? [tab.profileId] : []))).size > 1,
  };

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex h-9 shrink-0 items-end border-b bg-sidebar">
        <div
          role="tablist"
          aria-label={t("tabs.label")}
          ref={tabList}
          // The bar has no visible scrollbar; a mouse wheel scrolls it sideways.
          onWheel={(event) => {
            if (event.deltaX === 0) event.currentTarget.scrollLeft += event.deltaY;
          }}
          className="flex h-9 min-w-0 flex-1 items-end gap-px overflow-x-auto px-1.5 [scrollbar-width:none]"
        >
          {tabs.map((tab, index) => (
            <TabItem
              key={tab.id}
              tab={tab}
              index={index}
              count={tabs.length}
              active={tab.id === activeTabId}
              dragging={dragging}
              onDragChange={setDragging}
              renderLabel={renderLabel}
              context={context}
            />
          ))}
        </div>
        {overflowing && <TabsOverflowMenu renderLabel={renderLabel} context={context} />}
      </div>
      <div className="relative min-h-0 flex-1">
        {tabs.map((tab) => (
          <TabPanel key={tab.id} tab={tab} active={tab.id === activeTabId} renderTab={renderTab} />
        ))}
      </div>
    </div>
  );
}
