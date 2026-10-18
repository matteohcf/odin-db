import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { ShortcutsDialog } from "@/components/shortcuts-dialog";
import { ThemeMenu } from "@/components/theme-menu";
import { BackupsTabLabel, BackupsView } from "@/features/backups";
import { CollectionTab, CollectionTabLabel } from "@/features/collection";
import { ConnectionExplorer } from "@/features/connections";
import { MonitorTab, MonitorTabLabel } from "@/features/monitor";
import { useAutorunEnabled } from "@/features/perf-lab";
import { SettingsTabLabel, SettingsView, useApplySettings } from "@/features/settings";
import { ShellTab, ShellTabLabel } from "@/features/shell";
import { useUpdateNotifier } from "@/features/updates";
import { UsersTab, UsersTabLabel } from "@/features/users";
import { type TabLabelContext, type WorkspaceTab, WorkspaceTabs } from "@/features/workspace";
import { useSettings } from "@/lib/settings";
import { BackupsButton } from "./backups-button";
import { QuitDialog } from "./quit-dialog";
import { SettingsButton } from "./settings-button";
import { SidebarResizer } from "./sidebar-resizer";
import { usePruneRestoredTabs } from "./use-prune-restored-tabs";
import { useReconnectRestoredTabs } from "./use-reconnect-restored-tabs";
import { useWindowTitle } from "./use-window-title";
import { Welcome } from "./welcome";

// Benchmarks (xterm.js, large fixtures) only load for `--perf-autorun`.
const PerfLab = lazy(() =>
  import("@/features/perf-lab/components/perf-lab").then((m) => ({ default: m.PerfLab })),
);

/** Composition root: the only place that wires features together. */
export function App() {
  const { t } = useTranslation("app");
  const { data: perfAutorun } = useAutorunEnabled();
  useApplySettings();
  const sidebarWidth = useSettings((s) => s.sidebarWidth);
  usePruneRestoredTabs();
  useReconnectRestoredTabs();
  useWindowTitle();
  useUpdateNotifier();
  if (perfAutorun) {
    return (
      <Suspense fallback={null}>
        <PerfLab />
      </Suspense>
    );
  }

  return (
    <div className="flex h-full">
      <section
        aria-label={t("sidebar.label")}
        className="relative flex shrink-0 flex-col border-r bg-sidebar"
        style={{ width: sidebarWidth }}
      >
        <div className="min-h-0 flex-1">
          <ConnectionExplorer />
        </div>
        <SidebarResizer />
        <footer className="flex h-9 shrink-0 items-center gap-1 border-t px-1.5">
          <ThemeMenu />
          <BackupsButton />
          <SettingsButton />
        </footer>
      </section>
      <main className="min-w-0 flex-1">
        <WorkspaceTabs renderTab={renderTab} renderLabel={renderLabel} emptyState={<Welcome />} />
      </main>
      <ShortcutsDialog />
      <QuitDialog />
    </div>
  );
}

function renderLabel(tab: WorkspaceTab, context: TabLabelContext) {
  switch (tab.kind) {
    case "collection":
      return <CollectionTabLabel tab={tab} context={context} />;
    case "shell":
      return <ShellTabLabel tab={tab} />;
    case "server":
      return <MonitorTabLabel tab={tab} />;
    case "users":
      return <UsersTabLabel tab={tab} />;
    case "backups":
      return <BackupsTabLabel />;
    case "settings":
      return <SettingsTabLabel />;
  }
}

function renderTab(tab: WorkspaceTab) {
  switch (tab.kind) {
    case "collection":
      return <CollectionTab tab={tab} />;
    case "shell":
      return <ShellTab tab={tab} />;
    case "server":
      return <MonitorTab tab={tab} />;
    case "users":
      return <UsersTab tab={tab} />;
    case "backups":
      return <BackupsView />;
    case "settings":
      return <SettingsView />;
  }
}
