import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@odin-db/ui/components/context-menu";
import { cn } from "@odin-db/ui/lib/utils";
import { Copy, Pin, PinOff, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { useShortcut } from "@/hooks/use-shortcut";
import { label, SHORTCUTS } from "@/lib/shortcuts";
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
  const pinned = useTabs((s) => s.pinned);
  const togglePin = useTabs((s) => s.togglePin);
  const move = useTabs((s) => s.move);
  const reopenClosed = useTabs((s) => s.reopenClosed);
  const [dragging, setDragging] = useState<string | null>(null);

  const cycle = (delta: 1 | -1) => {
    const index = tabs.findIndex((tab) => tab.id === activeTabId);
    const next = tabs[(index + delta + tabs.length) % tabs.length];
    if (next) activate(next.id);
  };
  // Like VS Code, the keyboard does not close a pinned tab; its menu still can.
  useShortcut(
    "closeTab",
    () => activeTabId && !pinned.includes(activeTabId) && close(activeTabId),
    activeTabId !== null,
  );
  useShortcut("reopenTab", reopenClosed);
  const goTo = (index: number) => () => {
    const tab = index < 0 ? tabs.at(-1) : tabs[index];
    if (tab) activate(tab.id);
  };
  useShortcut("goToTab1", goTo(0), tabs.length > 0);
  useShortcut("goToTab2", goTo(1), tabs.length > 1);
  useShortcut("goToTab3", goTo(2), tabs.length > 2);
  useShortcut("goToTab4", goTo(3), tabs.length > 3);
  useShortcut("goToTab5", goTo(4), tabs.length > 4);
  useShortcut("goToTab6", goTo(5), tabs.length > 5);
  useShortcut("goToTab7", goTo(6), tabs.length > 6);
  useShortcut("goToTab8", goTo(7), tabs.length > 7);
  useShortcut("lastTab", goTo(-1), tabs.length > 0);
  useShortcut("nextTab", () => cycle(1), tabs.length > 1);
  useShortcut("previousTab", () => cycle(-1), tabs.length > 1);

  if (tabs.length === 0) return <>{emptyState}</>;
  const context: TabLabelContext = {
    showsSeveralConnections:
      new Set(tabs.flatMap((tab) => ("profileId" in tab ? [tab.profileId] : []))).size > 1,
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
          const isPinned = pinned.includes(tab.id);
          const name =
            tab.kind === "collection"
              ? tab.collection
              : tab.kind === "shell"
                ? t("tabs.shell")
                : t(`tabs.${tab.kind}`);
          return (
            <ContextMenu key={tab.id}>
              <ContextMenuTrigger asChild>
                {/* biome-ignore lint/a11y/noStaticElementInteractions: dragging is a pointer shortcut; the tab menu moves tabs from the keyboard. */}
                <div
                  data-tab-id={tab.id}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", tab.id);
                    setDragging(tab.id);
                  }}
                  onDragEnd={() => setDragging(null)}
                  onDragOver={(event) => dragging && event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (dragging && dragging !== tab.id) move(dragging, index);
                    setDragging(null);
                  }}
                  className={cn(
                    "group relative flex h-8 max-w-64 shrink-0 items-center rounded-t-md border border-b-0 text-[13px]",
                    dragging === tab.id && "opacity-50",
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
                    onAuxClick={(event) => event.button === 1 && !isPinned && close(tab.id)}
                    className="flex h-full min-w-0 items-center gap-1.5 pr-1 pl-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {renderLabel(tab, context)}
                  </button>
                  {isPinned ? (
                    <button
                      type="button"
                      aria-label={t("tabs.unpinNamed", { name })}
                      title={t("tabs.menu.unpin")}
                      onClick={() => togglePin(tab.id)}
                      className="mr-1 rounded-sm p-0.5 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Pin className="size-3.5" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      aria-label={t("tabs.close", { name })}
                      onClick={() => close(tab.id)}
                      className={cn(
                        "mr-1 rounded-sm p-0.5 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring",
                        active ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                      )}
                    >
                      <X className="size-3.5" />
                    </button>
                  )}
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent className="w-52">
                <ContextMenuItem onSelect={() => togglePin(tab.id)}>
                  {isPinned ? <PinOff /> : <Pin />}
                  {isPinned ? t("tabs.menu.unpin") : t("tabs.menu.pin")}
                </ContextMenuItem>
                {tab.kind === "collection" && (
                  <ContextMenuItem
                    onSelect={() =>
                      void navigator.clipboard.writeText(`${tab.database}.${tab.collection}`)
                    }
                  >
                    <Copy />
                    {t("tabs.menu.copyNamespace")}
                  </ContextMenuItem>
                )}
                <ContextMenuItem disabled={index === 0} onSelect={() => move(tab.id, index - 1)}>
                  {t("tabs.menu.moveLeft")}
                </ContextMenuItem>
                <ContextMenuItem
                  disabled={index === tabs.length - 1}
                  onSelect={() => move(tab.id, index + 1)}
                >
                  {t("tabs.menu.moveRight")}
                </ContextMenuItem>
                <ContextMenuSeparator />
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
                <ContextMenuItem onSelect={reopenClosed}>
                  {t("tabs.menu.reopen")}
                  <ContextMenuShortcut>{label(SHORTCUTS.reopenTab)}</ContextMenuShortcut>
                </ContextMenuItem>
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
