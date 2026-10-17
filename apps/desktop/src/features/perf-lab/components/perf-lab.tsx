import { commands } from "@odin-db/bindings";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@odin-db/ui/components/tabs";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppInfo } from "../api/use-app-info";
import { useAutorunEnabled } from "../api/use-autorun-enabled";
import { jsHeapMb } from "../lib/metrics";
import { buildReport } from "../lib/report";
import { useBenchResults } from "../store/bench-results-store";
import { BenchResults } from "./bench-results";
import { EditorBench } from "./editor-bench";
import { GridBench } from "./grid-bench";
import { TerminalBench } from "./terminal-bench";

const TABS = ["grid", "editor", "terminal"] as const;
type Tab = (typeof TABS)[number];

export function PerfLab() {
  const { t } = useTranslation("perfLab");
  const { data: info } = useAppInfo();
  const { data: autorun = false } = useAutorunEnabled();
  const [tab, setTab] = useState<Tab>("grid");

  function selectTab(value: string) {
    const next = TABS.find((candidate) => candidate === value);
    if (next) setTab(next);
  }

  // Autorun walks the tabs in order, then reports and exits.
  function advance() {
    void commands.perfAutorunLog(`${tab} done`);
    const next = TABS[TABS.indexOf(tab) + 1];
    if (next) {
      setTab(next);
      return;
    }
    const metrics = Object.values(useBenchResults.getState().results).flatMap((r) => r.metrics);
    const heap = jsHeapMb();
    const heapLine =
      heap === undefined
        ? t("results.heapUnavailable")
        : t("results.heap", { value: heap.toFixed(0) });
    void commands.perfAutorunFinish(buildReport(info, metrics, heapLine));
  }

  const autorunProps = (target: Tab) => ({
    autorun: autorun && tab === target,
    onAutorunDone: advance,
  });

  return (
    <Tabs value={tab} onValueChange={selectTab} className="flex h-full flex-col gap-0">
      <div className="flex items-center justify-between gap-4 border-b px-4 py-2">
        <TabsList>
          {TABS.map((value) => (
            <TabsTrigger key={value} value={value}>
              {t(`tabs.${value}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        {info && (
          <span className="truncate text-muted-foreground text-xs">
            {t("environment", {
              os: info.os,
              arch: info.arch,
              webview: info.webviewVersion,
              tauri: info.tauriVersion,
            })}
          </span>
        )}
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          <TabsContent value="grid" className="h-full">
            <GridBench {...autorunProps("grid")} />
          </TabsContent>
          <TabsContent value="editor" className="h-full">
            <EditorBench {...autorunProps("editor")} />
          </TabsContent>
          <TabsContent value="terminal" className="h-full">
            <TerminalBench {...autorunProps("terminal")} />
          </TabsContent>
        </div>
        <aside className="w-96 shrink-0 overflow-y-auto border-l">
          <BenchResults />
        </aside>
      </div>
    </Tabs>
  );
}
