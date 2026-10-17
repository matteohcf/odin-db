import type { TransferEvent, TransferProgress } from "@odin-db/bindings";
import { useCallback, useState } from "react";
import { useOperation } from "@/hooks/use-operation";

export type TransferState<S> =
  | { status: "idle" }
  | { status: "running"; progress: TransferProgress | null }
  | { status: "finished"; summary: S }
  | { status: "cancelled" }
  | { status: "failed"; error: string };

type Begin<S> = Parameters<ReturnType<typeof useOperation<TransferEvent<S>>>["start"]>[0];

/** A transfer: progress events, then a summary. */
export function useTransfer<S>() {
  const operation = useOperation<TransferEvent<S>>();
  const [progress, setProgress] = useState<TransferProgress | null>(null);
  const [summary, setSummary] = useState<S | null>(null);

  const start = useCallback(
    (begin: Begin<S>) => {
      setProgress(null);
      setSummary(null);
      return operation.start(begin, (event) => {
        if (event.kind === "finished") setSummary(event.value);
        else setProgress(event.value);
      });
    },
    [operation.start],
  );

  const { state: op } = operation;
  const state: TransferState<S> =
    op.status === "running"
      ? { status: "running", progress }
      : op.status === "completed" && summary !== null
        ? { status: "finished", summary }
        : op.status === "completed"
          ? { status: "running", progress }
          : op;

  return { state, start, cancel: operation.cancel };
}
