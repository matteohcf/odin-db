import { Badge } from "@odin-db/ui/components/badge";
import { Button } from "@odin-db/ui/components/button";
import { useTranslation } from "react-i18next";
import { useAppInfo } from "@/features/perf-lab/api/use-app-info";
import { jsHeapMb } from "@/features/perf-lab/lib/metrics";
import { buildReport } from "@/features/perf-lab/lib/report";
import { useBenchResults } from "@/features/perf-lab/store/bench-results-store";

export function BenchResults() {
  const { t } = useTranslation("perfLab");
  const { data: info } = useAppInfo();
  const results = Object.values(useBenchResults((s) => s.results));
  const clear = useBenchResults((s) => s.clear);
  const metrics = results.flatMap((r) => r.metrics);
  const heap = jsHeapMb();

  const heapLine =
    heap === undefined
      ? t("results.heapUnavailable")
      : t("results.heap", { value: heap.toFixed(0) });

  function copyReport() {
    void navigator.clipboard.writeText(buildReport(info, metrics, heapLine));
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-sm">{t("results.title")}</h2>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={clear} disabled={metrics.length === 0}>
            {t("actions.clear")}
          </Button>
          <Button size="sm" onClick={copyReport} disabled={metrics.length === 0}>
            {t("actions.copyReport")}
          </Button>
        </div>
      </div>
      {metrics.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("results.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {metrics.map((m) => (
            <li key={m.label} className="rounded-md border p-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{m.label}</span>
                {m.pass !== undefined && (
                  <Badge variant={m.pass ? "secondary" : "destructive"}>
                    {m.pass ? "PASS" : "FAIL"}
                  </Badge>
                )}
              </div>
              {m.value && <div className="mt-1 font-mono">{m.value}</div>}
              {m.budget && (
                <div className="text-muted-foreground">
                  {t("results.budget", { value: m.budget })}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="text-muted-foreground text-xs">{heapLine}</p>
    </div>
  );
}
