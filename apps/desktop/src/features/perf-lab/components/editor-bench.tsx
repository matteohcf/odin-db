import { json } from "@codemirror/lang-json";
import { EditorView } from "@codemirror/view";
import { commands, type EJsonDocument } from "@odin-db/bindings";
import { Button } from "@odin-db/ui/components/button";
import { basicSetup } from "codemirror";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { type AutorunProps, useAutorun } from "@/features/perf-lab/hooks/use-autorun";
import { budgets } from "@/features/perf-lab/lib/budgets";
import { runScrollBenchmark } from "@/features/perf-lab/lib/frame-stats";
import { afterPaint, formatDuration, formatFrames } from "@/features/perf-lab/lib/metrics";
import { useBenchResults } from "@/features/perf-lab/store/bench-results-store";
import { startStream } from "@/lib/streaming";

// Roughly 5 MB of pretty-printed canonical EJSON.
const DOCUMENT_COUNT = 7_500;
const APPROX_SIZE_MB = 5;

export function EditorBench({ autorun = false, onAutorunDone }: AutorunProps) {
  const { t } = useTranslation("perfLab");
  const record = useBenchResults((s) => s.record);
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!hostRef.current) return;
    const view = new EditorView({
      parent: hostRef.current,
      extensions: [basicSetup, json(), EditorView.theme({ "&": { height: "100%" } })],
    });
    viewRef.current = view;
    return () => view.destroy();
  }, []);

  useAutorun(
    autorun,
    async () => {
      await load();
      await benchmark();
    },
    onAutorunDone,
  );

  async function load() {
    const view = viewRef.current;
    if (!view) return;
    setBusy(true);
    const documents: EJsonDocument[] = [];
    const handle = await startStream<EJsonDocument[]>(
      (channel) =>
        commands.streamSampleDocuments({ count: DOCUMENT_COUNT, batchSize: 1000 }, channel),
      (batch) => {
        for (const doc of batch) documents.push(doc);
      },
    );
    await handle.done;
    const text = JSON.stringify(documents, null, 2);

    const startedAt = performance.now();
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
    await afterPaint();
    const elapsed = performance.now() - startedAt;

    record({
      id: "editorLoad",
      metrics: [
        {
          label: `${t("metrics.editorLoad")} (${(text.length / 1024 / 1024).toFixed(1)} MB)`,
          ...formatDuration(elapsed, budgets.editorLoadMs),
        },
      ],
    });
    setLoaded(true);
    setBusy(false);
  }

  async function benchmark() {
    const view = viewRef.current;
    if (!view) return;
    setBusy(true);
    const summary = await runScrollBenchmark(view.scrollDOM, "steady", 8000);
    record({
      id: "editorScroll",
      metrics: [{ label: t("metrics.editorScroll"), ...formatFrames(summary) }],
    });
    setBusy(false);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <Button size="sm" onClick={load} disabled={busy}>
          {t("actions.loadEditor", { size: APPROX_SIZE_MB })}
        </Button>
        <Button size="sm" variant="secondary" onClick={benchmark} disabled={busy || !loaded}>
          {t("actions.scrollSteady")}
        </Button>
      </div>
      <div ref={hostRef} className="min-h-0 flex-1 overflow-hidden text-sm" />
    </div>
  );
}
