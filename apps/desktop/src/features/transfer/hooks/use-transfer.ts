import type { TransferProgress } from "@odin-db/bindings";
import { useCallback, useState } from "react";
import { useOperation } from "@/hooks/use-operation";

export type TransferState<S, P = TransferProgress> =
  | { status: "idle" }
  | { status: "running"; progress: P | null }
  | { status: "finished"; summary: S }
  | { status: "cancelled" }
  | { status: "failed"; error: string };

type Event<S, P> = { kind: "progress"; value: P } | { kind: "finished"; value: S };

type Begin<S, P> = Parameters<ReturnType<typeof useOperation<Event<S, P>>>["start"]>[0];

/** A transfer: progress events, then a summary. */
export function useTransfer<S, P = TransferProgress>(title?: string) {
  const operation = useOperation<Event<S, P>>(title);
  const [progress, setProgress] = useState<P | null>(null);
  const [summary, setSummary] = useState<S | null>(null);

  const start = useCallback(
    (begin: Begin<S, P>) => {
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
  const state: TransferState<S, P> =
    op.status === "running"
      ? { status: "running", progress }
      : op.status === "completed" && summary !== null
        ? { status: "finished", summary }
        : op.status === "completed"
          ? { status: "running", progress }
          : op;

  return { state, start, cancel: operation.cancel };
}
