import { commands } from "@odin-db/bindings";
import { Button } from "@odin-db/ui/components/button";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { type AutorunProps, useAutorun } from "@/features/perf-lab/hooks/use-autorun";
import { budgets } from "@/features/perf-lab/lib/budgets";
import { recordFrames } from "@/features/perf-lab/lib/frame-stats";
import { formatFrames } from "@/features/perf-lab/lib/metrics";
import { createTerminalWriter } from "@/features/perf-lab/lib/terminal-writer";
import { useBenchResults } from "@/features/perf-lab/store/bench-results-store";
import { startStream } from "@/lib/streaming";

const TOTAL_MB = 50;
const CHUNK_BYTES = 64 * 1024;

type Renderer = "webgl" | "dom";

export function TerminalBench({ autorun = false, onAutorunDone }: AutorunProps) {
  const { t } = useTranslation("perfLab");
  const record = useBenchResults((s) => s.record);
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  // Read by the benchmark, which can run before the state update re-renders.
  const rendererRef = useRef<Renderer>("dom");
  const [renderer, setRenderer] = useState<Renderer>("dom");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const terminal = new Terminal({ fontSize: 13, scrollback: 10_000, convertEol: false });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      terminal.loadAddon(webgl);
      rendererRef.current = "webgl";
      setRenderer("webgl");
    } catch {
      // WebGL unavailable (some Linux drivers): xterm falls back to the DOM renderer.
      setRenderer("dom");
    }
    fit.fit();
    const observer = new ResizeObserver(() => fit.fit());
    observer.observe(host);
    terminalRef.current = terminal;
    return () => {
      observer.disconnect();
      terminal.dispose();
    };
  }, []);

  useAutorun(autorun, () => stream(), onAutorunDone);

  async function stream() {
    const terminal = terminalRef.current;
    if (!terminal) return;
    setBusy(true);
    terminal.reset();

    let bytes = 0;
    const writer = createTerminalWriter(terminal);
    const recorder = recordFrames();
    const startedAt = performance.now();
    const handle = await startStream<string>(
      (channel) =>
        commands.streamTerminalOutput(
          { totalBytes: TOTAL_MB * 1024 * 1024, chunkBytes: CHUNK_BYTES },
          channel,
        ),
      (chunk) => {
        bytes += chunk.length;
        writer.write(chunk);
      },
    );
    await handle.done;
    await writer.drained();
    const seconds = (performance.now() - startedAt) / 1000;
    const frames = recorder.stop();
    const mbPerSec = bytes / 1024 / 1024 / seconds;

    record({
      id: "terminal",
      metrics: [
        {
          label: t("metrics.terminalThroughput"),
          value: `${mbPerSec.toFixed(1)} MB/s`,
          budget: `≥ ${budgets.terminalMbPerSec} MB/s`,
          pass: mbPerSec >= budgets.terminalMbPerSec,
        },
        { label: t("metrics.terminalFrames"), ...formatFrames(frames) },
        { label: t("results.renderer", { renderer: rendererRef.current }), value: "" },
      ],
    });
    setBusy(false);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <Button size="sm" onClick={stream} disabled={busy}>
          {t("actions.streamTerminal", { size: TOTAL_MB })}
        </Button>
        <span className="ml-auto text-muted-foreground text-xs">
          {t("results.renderer", { renderer })}
        </span>
      </div>
      <div ref={hostRef} className="min-h-0 flex-1 bg-black p-2" />
    </div>
  );
}
