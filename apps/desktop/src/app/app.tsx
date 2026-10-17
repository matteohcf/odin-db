import { lazy, Suspense } from "react";
import { ThemeMenu } from "@/components/theme-menu";
import { CollectionTab, CollectionTabLabel } from "@/features/collection";
import { ConnectionExplorer } from "@/features/connections";
import { useAutorunEnabled } from "@/features/perf-lab";
import { type TabLabelContext, type WorkspaceTab, WorkspaceTabs } from "@/features/workspace";
import { Welcome } from "./welcome";

// Benchmarks (xterm.js, large fixtures) only load for `--perf-autorun`.
const PerfLab = lazy(() =>
  import("@/features/perf-lab/components/perf-lab").then((m) => ({ default: m.PerfLab })),
);

/** Composition root: the only place that wires features together. */
export function App() {
  const { data: perfAutorun } = useAutorunEnabled();
  if (perfAutorun) {
    return (
      <Suspense fallback={null}>
        <PerfLab />
      </Suspense>
    );
  }

  return (
    <div className="flex h-full">
      <div className="flex w-64 shrink-0 flex-col border-r bg-sidebar">
        <div className="min-h-0 flex-1">
          <ConnectionExplorer />
        </div>
        <footer className="flex h-9 shrink-0 items-center border-t px-1.5">
          <ThemeMenu />
        </footer>
      </div>
      <main className="min-w-0 flex-1">
        <WorkspaceTabs renderTab={renderTab} renderLabel={renderLabel} emptyState={<Welcome />} />
      </main>
    </div>
  );
}

function renderLabel(tab: WorkspaceTab, context: TabLabelContext) {
  switch (tab.kind) {
    case "collection":
      return <CollectionTabLabel tab={tab} context={context} />;
  }
}

function renderTab(tab: WorkspaceTab) {
  switch (tab.kind) {
    case "collection":
      return <CollectionTab tab={tab} />;
  }
}
