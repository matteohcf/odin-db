import { commands, type EJsonDocument, type JsonValue } from "@odin-db/bindings";
import { Button } from "@odin-db/ui/components/button";
import { createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";
import type { JsonObject } from "../../../lib/ejson-display";
import { createFrameBatcher } from "../../../lib/frame-batcher";
import { type StreamHandle, startStream } from "../../../lib/streaming";
import { type AutorunProps, useAutorun } from "../hooks/use-autorun";
import { budgets } from "../lib/budgets";
import { runScrollBenchmark, type ScrollMode } from "../lib/frame-stats";
import { afterPaint, formatDuration, formatFrames } from "../lib/metrics";
import { useBenchResults } from "../store/bench-results-store";
import { createResultStore } from "../store/result-store";
import { EJsonCell } from "./ejson-cell";

const DOCUMENT_COUNT = 100_000;
const BATCH_SIZE = 500;
const ROW_HEIGHT = 32;
const COLUMN_WIDTH = 200;
const EMPTY_ROW: JsonObject = {};

const features = tableFeatures({});
const helper = createColumnHelper<typeof features, JsonObject>();

function columnsFor(keys: readonly string[]) {
  return helper.columns(
    keys.map((key) =>
      helper.accessor((row): JsonValue | undefined => row[key], {
        id: key,
        header: key,
        cell: (info) => <EJsonCell value={info.getValue()} />,
      }),
    ),
  );
}

export function GridBench({ autorun = false, onAutorunDone }: AutorunProps) {
  const { t } = useTranslation("perfLab");
  const [store] = useState(createResultStore);
  const rows = useStore(store, (s) => s.rows);
  const status = useStore(store, (s) => s.status);
  const record = useBenchResults((s) => s.record);
  const streamRef = useRef<StreamHandle | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [benchmarking, setBenchmarking] = useState(false);

  const firstRow = rows[0];
  const keys = useMemo(() => Object.keys(firstRow ?? EMPTY_ROW), [firstRow]);
  const columns = useMemo(() => columnsFor(keys), [keys]);
  const table = useTable({ features, columns, data: rows });

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  useEffect(() => () => void streamRef.current?.cancel(), []);

  async function load() {
    const { reset, append, setStatus } = store.getState();
    reset();
    const batcher = createFrameBatcher<EJsonDocument>(append);
    const startedAt = performance.now();
    const handle = await startStream<EJsonDocument[]>(
      (channel) =>
        commands.streamSampleDocuments({ count: DOCUMENT_COUNT, batchSize: BATCH_SIZE }, channel),
      (batch) => batcher.push(batch),
    );
    streamRef.current = handle;
    const outcome = await handle.done;
    batcher.flushNow();
    streamRef.current = null;

    if (outcome.status === "failed") {
      setStatus({ type: "failed", error: outcome.error });
      return;
    }
    setStatus({ type: outcome.status });
    if (outcome.status === "completed") {
      record({
        id: "gridLoad",
        metrics: [
          {
            label: t("metrics.gridLoad"),
            ...formatDuration(performance.now() - startedAt, budgets.gridLoadMs),
          },
        ],
      });
    }
  }

  async function benchmark(mode: ScrollMode) {
    if (!scrollRef.current) return;
    setBenchmarking(true);
    const summary = await runScrollBenchmark(scrollRef.current, mode, 8000);
    setBenchmarking(false);
    const id = mode === "steady" ? "gridScrollSteady" : "gridScrollJump";
    record({ id, metrics: [{ label: t(`metrics.${id}`), ...formatFrames(summary) }] });
  }

  useAutorun(
    autorun,
    async () => {
      await load();
      await afterPaint();
      await benchmark("steady");
      await benchmark("jump");
    },
    onAutorunDone,
  );

  const loading = status.type === "loading";
  const canBenchmark = rows.length > 0 && !loading && !benchmarking;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <Button size="sm" onClick={load} disabled={loading || benchmarking}>
          {t("actions.load", { count: DOCUMENT_COUNT })}
        </Button>
        {loading && (
          <Button size="sm" variant="outline" onClick={() => void streamRef.current?.cancel()}>
            {t("actions.cancel")}
          </Button>
        )}
        <Button
          size="sm"
          variant="secondary"
          onClick={() => benchmark("steady")}
          disabled={!canBenchmark}
        >
          {t("actions.scrollSteady")}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => benchmark("jump")}
          disabled={!canBenchmark}
        >
          {t("actions.scrollJump")}
        </Button>
        <span className="ml-auto text-muted-foreground text-xs">
          {status.type === "failed"
            ? t("status.failed", { message: status.error.message })
            : status.type === "cancelled"
              ? t("status.cancelled")
              : t("status.rows", { count: rows.length })}
        </span>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        <div style={{ width: keys.length * COLUMN_WIDTH }}>
          <div className="sticky top-0 z-10 flex border-b bg-muted/80 backdrop-blur">
            {table.getHeaderGroups().flatMap((group) =>
              group.headers.map((header) => (
                <div
                  key={header.id}
                  className="shrink-0 truncate px-3 py-2 font-medium text-xs"
                  style={{ width: COLUMN_WIDTH }}
                >
                  <table.FlexRender header={header} />
                </div>
              )),
            )}
          </div>
          <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const row = rows[item.index];
              if (!row) return null;
              return (
                <div
                  key={item.index}
                  className="absolute left-0 flex w-full items-center border-b hover:bg-accent/50"
                  style={{ height: ROW_HEIGHT, transform: `translateY(${item.start}px)` }}
                >
                  {keys.map((key) => (
                    <div
                      key={key}
                      className="flex shrink-0 overflow-hidden px-3"
                      style={{ width: COLUMN_WIDTH }}
                    >
                      <EJsonCell value={row[key]} />
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
