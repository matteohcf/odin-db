import type { AppInfo } from "@odin-db/bindings";
import type { Metric } from "../store/bench-results-store";

export function buildReport(
  info: AppInfo | undefined,
  metrics: readonly Metric[],
  heapLine: string,
) {
  const environment = info
    ? `${info.os} ${info.arch}, WebView ${info.webviewVersion}, Tauri ${info.tauriVersion}`
    : "unknown environment";
  return [
    `## odin-db Milestone 0 · ${environment}`,
    "",
    "| Metric | Result | Budget | Pass |",
    "|---|---|---|---|",
    ...metrics.map((m) => {
      const pass = m.pass === undefined ? "" : m.pass ? "✅" : "❌";
      return `| ${m.label} | ${m.value} | ${m.budget ?? ""} | ${pass} |`;
    }),
    "",
    heapLine,
  ].join("\n");
}
