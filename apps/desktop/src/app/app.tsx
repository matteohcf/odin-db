import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { ShortcutsDialog } from "@/components/shortcuts-dialog";
import { ThemeMenu } from "@/components/theme-menu";
import { BackupsTabLabel } from "@/features/backups";
import { CollectionTab, CollectionTabLabel } from "@/features/collection";
import { ConnectionExplorer } from "@/features/connections";
import { DiagramTabLabel } from "@/features/diagram";
import { MonitorTabLabel } from "@/features/monitor";
import { useAutorunEnabled } from "@/features/perf-lab";
import { QueriesTabLabel } from "@/features/queries";
import { SettingsTabLabel, useApplySettings } from "@/features/settings";
import { ShellTab, ShellTabLabel } from "@/features/shell";
import { useUpdateNotifier } from "@/features/updates";
import { UsersTabLabel } from "@/features/users";
import {
  type TabLabelContext,
  useTabs,
  type WorkspaceTab,
  WorkspaceTabs,
} from "@/features/workspace";
import { clampSidebarWidth, useSettings } from "@/lib/settings";
import { BackupsButton } from "./backups-button";
import { QueriesButton } from "./queries-button";
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

// React Flow and the layout engine only load with a diagram tab (ADR-0043).
const DiagramTab = lazy(() =>
  import("@/features/diagram/components/diagram-tab").then((m) => ({ default: m.DiagramTab })),
);

// Pages opened from a menu load with their first tab, keeping them out of the startup bundle.
const MonitorTab = lazy(() =>
  import("@/features/monitor/components/monitor-tab").then((m) => ({ default: m.MonitorTab })),
);
const UsersTab = lazy(() =>
  import("@/features/users/components/users-tab").then((m) => ({ default: m.UsersTab })),
);
const QueriesView = lazy(() =>
  import("@/features/queries/components/queries-view").then((m) => ({ default: m.QueriesView })),
);
const BackupsView = lazy(() =>
  import("@/features/backups/components/backups-view").then((m) => ({ default: m.BackupsView })),
);
const SettingsView = lazy(() =>
  import("@/features/settings/components/settings-view").then((m) => ({
    default: m.SettingsView,
  })),
);

/** Composition root: the only place that wires features together. */
export function App() {
  const { t } = useTranslation("app");
  const { data: perfAutorun } = useAutorunEnabled();
  const openSettings = useTabs((s) => s.openSettings);
  useApplySettings();
  // Widths saved before the minimum grew are clamped too.
  const sidebarWidth = clampSidebarWidth(useSettings((s) => s.sidebarWidth));
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
          <QueriesButton />
          <BackupsButton />
          <SettingsButton />
        </footer>
      </section>
      <main className="min-w-0 flex-1">
        <WorkspaceTabs renderTab={renderTab} renderLabel={renderLabel} emptyState={<Welcome />} />
      </main>
      <ShortcutsDialog onCustomize={() => openSettings("keyboard")} />
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
    case "diagram":
      return <DiagramTabLabel tab={tab} />;
    case "queries":
      return <QueriesTabLabel />;
    case "backups":
      return <BackupsTabLabel />;
    case "settings":
      return <SettingsTabLabel />;
  }
}

function renderTab(tab: WorkspaceTab) {
  return <Suspense fallback={null}>{tabContent(tab)}</Suspense>;
}

function tabContent(tab: WorkspaceTab) {
  switch (tab.kind) {
    case "collection":
      return <CollectionTab tab={tab} />;
    case "shell":
      return <ShellTab tab={tab} />;
    case "server":
      return <MonitorTab tab={tab} />;
    case "users":
      return <UsersTab tab={tab} />;
    case "diagram":
      return <DiagramTab tab={tab} />;
    case "queries":
      return <QueriesView />;
    case "backups":
      return <BackupsView />;
    case "settings":
      return <SettingsView {...(tab.page ? { page: tab.page } : {})} />;
  }
}
