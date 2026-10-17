import { commands, type OperationId, type StreamEvent } from "@odin-db/bindings";
import type { Channel } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "@/lib/ipc";
import { startStream } from "@/lib/streaming";

export type OperationStatus =
  | { status: "idle" }
  | { status: "running" }
  | { status: "completed" }
  | { status: "cancelled" }
  | { status: "failed"; error: string };

/** Starts the backend operation; resolves `null` when the user dismissed a file dialog. */
type Begin<E> = (channel: Channel<StreamEvent<E>>) => Promise<OperationId | null>;

/**
 * One cancellable long-running operation (ADR-0006). Stop works even before the
 * backend has returned the operation id, and unmounting cancels a running operation.
 */
export function useOperation<E>() {
  const [state, setState] = useState<OperationStatus>({ status: "idle" });
  const operation = useRef<OperationId | null>(null);
  const cancelRequested = useRef(false);

  useEffect(
    () => () => {
      if (operation.current) void commands.cancelOperation(operation.current);
    },
    [],
  );

  /** Returns false if nothing started (dialog dismissed). */
  const start = useCallback(
    async (begin: Begin<E>, onEvent: (event: E) => void): Promise<boolean> => {
      cancelRequested.current = false;
      setState({ status: "running" });
      try {
        let started = false;
        const handle = await startStream<E>(async (channel) => {
          const id = await begin(channel);
          started = id !== null;
          return id ?? "";
        }, onEvent);
        if (!started) {
          setState({ status: "idle" });
          return false;
        }
        operation.current = handle.id;
        if (cancelRequested.current) void commands.cancelOperation(handle.id);
        const outcome = await handle.done;
        operation.current = null;
        setState(
          outcome.status === "failed"
            ? { status: "failed", error: errorMessage(outcome.error.message) }
            : { status: outcome.status },
        );
      } catch (error) {
        setState({ status: "failed", error: errorMessage(error) });
      }
      return true;
    },
    [],
  );

  const cancel = useCallback(() => {
    cancelRequested.current = true;
    if (operation.current) void commands.cancelOperation(operation.current);
  }, []);

  const reset = useCallback(() => setState({ status: "idle" }), []);

  return { state, start, cancel, reset };
}
