import type { BackupEvent, ToolSummary } from "@odin-db/bindings";
import { useCallback, useState } from "react";
import { useOperation } from "@/hooks/use-operation";

const LOG_LIMIT = 500;

type Begin = Parameters<ReturnType<typeof useOperation<BackupEvent>>["start"]>[0];

/** A mongodump/mongorestore run: streamed output lines and final totals. */
export function useToolRun() {
  const operation = useOperation<BackupEvent>();
  const [lines, setLines] = useState<string[]>([]);
  const [summary, setSummary] = useState<ToolSummary | null>(null);

  const start = useCallback(
    (begin: Begin) => {
      setLines([]);
      setSummary(null);
      return operation.start(begin, (event) => {
        if (event.kind === "finished") {
          setSummary(event.value);
          return;
        }
        const output = event.value;
        const line =
          output.kind === "collection"
            ? `${output.namespace}: ${output.documents ?? 0} documents${output.failures ? `, ${output.failures} failed` : ""}`
            : output.line;
        setLines((current) => [...current.slice(-(LOG_LIMIT - 1)), line]);
      });
    },
    [operation.start],
  );

  return { state: operation.state, lines, summary, start, cancel: operation.cancel };
}
