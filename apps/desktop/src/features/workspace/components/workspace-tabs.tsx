import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@odin-db/ui/components/context-menu";
import { cn } from "@odin-db/ui/lib/utils";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useShortcut } from "@/hooks/use-shortcut";
import { useTabs, type WorkspaceTab } from "../store/tabs-store";

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
  const activate = useTabs((s) => s.activate);
  const close = useTabs((s) => s.close);
  const closeOthers = useTabs((s) => s.closeOthers);
  const closeToTheRight = useTabs((s) => s.closeToTheRight);
  const closeAll = useTabs((s) => s.closeAll);

  const cycle = (delta: 1 | -1) => {
    const index = tabs.findIndex((tab) => tab.id === activeTabId);
    const next = tabs[(index + delta + tabs.length) % tabs.length];
    if (next) activate(next.id);
  };
  useShortcut("closeTab", () => activeTabId && close(activeTabId), activeTabId !== null);
  useShortcut("nextTab", () => cycle(1), tabs.length > 1);
  useShortcut("previousTab", () => cycle(-1), tabs.length > 1);

  if (tabs.length === 0) return <>{emptyState}</>;
  const context: TabLabelContext = {
    showsSeveralConnections: new Set(tabs.map((tab) => tab.profileId)).size > 1,
  };

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div
        role="tablist"
        aria-label={t("tabs.label")}
        className="flex h-9 shrink-0 items-end gap-px overflow-x-auto border-b bg-sidebar px-1.5 [scrollbar-width:none]"
      >
        {tabs.map((tab, index) => {
          const active = tab.id === activeTabId;
          return (
            <ContextMenu key={tab.id}>
              <ContextMenuTrigger asChild>
                <div
                  className={cn(
                    "group relative flex h-8 max-w-64 shrink-0 items-center rounded-t-md border border-b-0 text-[13px]",
                    active
                      ? "border-border bg-background text-foreground after:absolute after:inset-x-0 after:-bottom-px after:h-px after:bg-background"
                      : "border-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                  )}
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => activate(tab.id)}
                    onAuxClick={(event) => event.button === 1 && close(tab.id)}
                    className="flex h-full min-w-0 items-center gap-1.5 pr-1 pl-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {renderLabel(tab, context)}
                  </button>
                  <button
                    type="button"
                    aria-label={t("tabs.close", {
                      name: tab.kind === "collection" ? tab.collection : t("tabs.shell"),
                    })}
                    onClick={() => close(tab.id)}
                    className={cn(
                      "mr-1 rounded-sm p-0.5 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring",
                      active ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                    )}
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent className="w-48">
                <ContextMenuItem onSelect={() => close(tab.id)}>
                  {t("tabs.menu.close")}
                </ContextMenuItem>
                <ContextMenuItem disabled={tabs.length === 1} onSelect={() => closeOthers(tab.id)}>
                  {t("tabs.menu.closeOthers")}
                </ContextMenuItem>
                <ContextMenuItem
                  disabled={index === tabs.length - 1}
                  onSelect={() => closeToTheRight(tab.id)}
                >
                  {t("tabs.menu.closeToTheRight")}
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem onSelect={closeAll}>{t("tabs.menu.closeAll")}</ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          );
        })}
      </div>
      <div className="relative min-h-0 flex-1">
        {tabs.map((tab) => (
          <div key={tab.id} role="tabpanel" hidden={tab.id !== activeTabId} className="h-full">
            {renderTab(tab)}
          </div>
        ))}
      </div>
    </div>
  );
}
