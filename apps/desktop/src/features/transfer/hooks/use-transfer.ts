import type {
  IpcError,
  OperationId,
  StreamEvent,
  TransferEvent,
  TransferProgress,
} from "@odin-db/bindings";
import { commands } from "@odin-db/bindings";
import type { Channel } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "@/lib/ipc";
import { startStream } from "@/lib/streaming";

export type TransferState<S> =
  | { status: "idle" }
  | { status: "running"; progress: TransferProgress | null }
  | { status: "finished"; summary: S }
  | { status: "cancelled" }
  | { status: "failed"; error: string };

type Start<S> = (channel: Channel<StreamEvent<TransferEvent<S>>>) => Promise<OperationId | null>;

/** Runs one cancellable transfer and tracks its progress and outcome. */
export function useTransfer<S>() {
  const [state, setState] = useState<TransferState<S>>({ status: "idle" });
  const operation = useRef<OperationId | null>(null);
  // Stop can be pressed before the backend has returned the operation id.
  const cancelRequested = useRef(false);

  // Leaving the dialog mid-transfer cancels it rather than orphaning it.
  useEffect(
    () => () => {
      if (operation.current) void commands.cancelOperation(operation.current);
    },
    [],
  );

  const start = useCallback(async (begin: Start<S>): Promise<boolean> => {
    let summary: S | undefined;
    cancelRequested.current = false;
    setState({ status: "running", progress: null });
    try {
      let started = false;
      const handle = await startStream<TransferEvent<S>>(
        async (channel) => {
          const id = await begin(channel);
          started = id !== null;
          // `startStream` needs an id; a cancelled file dialog never starts anything.
          return id ?? "";
        },
        (event) => {
          if (event.kind === "finished") summary = event.value;
          else if (summary === undefined) setState({ status: "running", progress: event.value });
        },
      );
      if (!started) {
        setState({ status: "idle" });
        return false;
      }
      operation.current = handle.id;
      if (cancelRequested.current) void commands.cancelOperation(handle.id);
      const outcome = await handle.done;
      operation.current = null;
      if (outcome.status === "failed")
        setState({ status: "failed", error: errorMessage(outcome.error.message) });
      else if (outcome.status === "cancelled") setState({ status: "cancelled" });
      else if (summary !== undefined) setState({ status: "finished", summary });
      return true;
    } catch (error) {
      setState({
        status: "failed",
        error: errorMessage(isIpcError(error) ? error.message : error),
      });
      return true;
    }
  }, []);

  const cancel = useCallback(() => {
    cancelRequested.current = true;
    if (operation.current) void commands.cancelOperation(operation.current);
  }, []);

  return { state, start, cancel };
}

function isIpcError(value: unknown): value is IpcError {
  return typeof value === "object" && value !== null && "kind" in value && "message" in value;
}
