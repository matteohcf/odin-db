import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@odin-db/ui/components/context-menu";
import { cn } from "@odin-db/ui/lib/utils";
import { Copy, CopyPlus, Pin, PinOff, X } from "lucide-react";
import { memo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useKeybindingLabel } from "@/hooks/use-keybinding";
import { useTabs, type WorkspaceTab } from "../store/tabs-store";
import type { TabLabelContext } from "./workspace-tabs";

interface TabItemProps {
  tab: WorkspaceTab;
  index: number;
  /** How many tabs are open, for the menu's limits. */
  count: number;
  active: boolean;
  dragging: string | null;
  onDragChange: (id: string | null) => void;
  renderLabel: (tab: WorkspaceTab, context: TabLabelContext) => ReactNode;
  context: TabLabelContext;
}

/** One tab: its label, a close (or unpin) button, dragging, and its menu. */
export const TabItem = memo(function TabItem({
  tab,
  index,
  count,
  active,
  dragging,
  onDragChange,
  renderLabel,
  context,
}: TabItemProps) {
  const reopenTabKeys = useKeybindingLabel("reopenTab");
  const { t } = useTranslation("workspace");
  const isPinned = useTabs((s) => s.pinned.includes(tab.id));
  const activate = useTabs((s) => s.activate);
  const close = useTabs((s) => s.close);
  const closeOthers = useTabs((s) => s.closeOthers);
  const closeToTheRight = useTabs((s) => s.closeToTheRight);
  const closeAll = useTabs((s) => s.closeAll);
  const closeConnection = useTabs((s) => s.closeConnection);
  const togglePin = useTabs((s) => s.togglePin);
  const move = useTabs((s) => s.move);
  const reopenClosed = useTabs((s) => s.reopenClosed);
  const duplicate = useTabs((s) => s.duplicate);
  const name =
    tab.kind === "collection"
      ? tab.collection
      : tab.kind === "shell"
        ? t("tabs.shell")
        : tab.kind === "diagram"
          ? t("tabs.diagram", { database: tab.database })
          : t(`tabs.${tab.kind}`);
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {/* biome-ignore lint/a11y/noStaticElementInteractions: dragging is a pointer shortcut; the tab menu moves tabs from the keyboard. */}
        <div
          data-tab-id={tab.id}
          draggable
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", tab.id);
            onDragChange(tab.id);
          }}
          onDragEnd={() => onDragChange(null)}
          onDragOver={(event) => dragging && event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            if (dragging && dragging !== tab.id) move(dragging, index);
            onDragChange(null);
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
            // Pointer shortcuts: the tab menu and Cmd+W do the same from the keyboard,
            // and a tab list may only hold tabs for assistive technology.
            <button
              type="button"
              tabIndex={-1}
              aria-hidden
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
              tabIndex={-1}
              aria-hidden
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
          <ContextMenuItem onSelect={() => duplicate(tab.id)}>
            <CopyPlus />
            {t("tabs.menu.duplicate")}
          </ContextMenuItem>
        )}
        {tab.kind === "collection" && (
          <ContextMenuItem
            onSelect={() => void navigator.clipboard.writeText(`${tab.database}.${tab.collection}`)}
          >
            <Copy />
            {t("tabs.menu.copyNamespace")}
          </ContextMenuItem>
        )}
        <ContextMenuItem disabled={index === 0} onSelect={() => move(tab.id, index - 1)}>
          {t("tabs.menu.moveLeft")}
        </ContextMenuItem>
        <ContextMenuItem disabled={index === count - 1} onSelect={() => move(tab.id, index + 1)}>
          {t("tabs.menu.moveRight")}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => close(tab.id)}>{t("tabs.menu.close")}</ContextMenuItem>
        <ContextMenuItem disabled={count === 1} onSelect={() => closeOthers(tab.id)}>
          {t("tabs.menu.closeOthers")}
        </ContextMenuItem>
        <ContextMenuItem disabled={index === count - 1} onSelect={() => closeToTheRight(tab.id)}>
          {t("tabs.menu.closeToTheRight")}
        </ContextMenuItem>
        {"profileId" in tab && (
          <ContextMenuItem onSelect={() => closeConnection(tab.profileId)}>
            {t("tabs.menu.closeConnection")}
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={closeAll}>{t("tabs.menu.closeAll")}</ContextMenuItem>
        <ContextMenuItem onSelect={reopenClosed}>
          {t("tabs.menu.reopen")}
          {reopenTabKeys && <ContextMenuShortcut>{reopenTabKeys}</ContextMenuShortcut>}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
});
