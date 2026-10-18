import { memo, type ReactNode } from "react";
import type { WorkspaceTab } from "../store/tabs-store";

// Switching tabs re-renders only the two panels whose visibility changes.
export const TabPanel = memo(function TabPanel({
  tab,
  active,
  renderTab,
}: {
  tab: WorkspaceTab;
  active: boolean;
  renderTab: (tab: WorkspaceTab) => ReactNode;
}) {
  return (
    <div role="tabpanel" hidden={!active} className="h-full">
      {renderTab(tab)}
    </div>
  );
});
