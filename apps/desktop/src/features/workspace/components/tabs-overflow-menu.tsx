import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@odin-db/ui/components/dropdown-menu";
import { cn } from "@odin-db/ui/lib/utils";
import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useTabs, type WorkspaceTab } from "../store/tabs-store";

import type { TabLabelContext } from "./workspace-tabs";

/** Every open tab in a menu, for when they do not fit the bar. */
export function TabsOverflowMenu({
  renderLabel,
  context,
}: {
  renderLabel: (tab: WorkspaceTab, context: TabLabelContext) => ReactNode;
  context: TabLabelContext;
}) {
  const { t } = useTranslation("workspace");
  const tabs = useTabs((s) => s.tabs);
  const activeTabId = useTabs((s) => s.activeTabId);
  const activate = useTabs((s) => s.activate);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("tabs.all", { count: tabs.length })}
          title={t("tabs.all", { count: tabs.length })}
          className="mx-1 mb-1 flex h-7 shrink-0 items-center gap-0.5 rounded-md px-1.5 text-muted-foreground text-xs tabular-nums outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          {tabs.length}
          <ChevronDown className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-96 w-72 overflow-y-auto">
        {tabs.map((tab) => (
          <DropdownMenuItem
            key={tab.id}
            onSelect={() => activate(tab.id)}
            className={cn("gap-1.5", tab.id === activeTabId && "bg-accent/60 font-medium")}
          >
            {renderLabel(tab, context)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
