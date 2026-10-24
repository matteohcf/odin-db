import { commands, type OperationId, type StreamEvent } from "@odin-db/bindings";
import type { Channel } from "@tauri-apps/api/core";
import i18n from "i18next";
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
export function useOperation<E>(
  /** Names the operation in a desktop notification when it ends in the background. */
  title?: string,
) {
  const [state, setState] = useState<OperationStatus>({ status: "idle" });
  const operation = useRef<OperationId | null>(null);
  // The latest start; cancelling marks it, and an older start that resolves late is ignored.
  const latest = useRef<{ cancelled: boolean } | null>(null);

  useEffect(
    () => () => {
      if (operation.current) void commands.cancelOperation(operation.current);
    },
    [],
  );

  /** Returns false if nothing started (dialog dismissed). */
  const start = useCallback(
    async (begin: Begin<E>, onEvent: (event: E) => void): Promise<boolean> => {
      const run = { cancelled: false };
      latest.current = run;
      setState({ status: "running" });
      try {
        let started = false;
        const handle = await startStream<E>(async (channel) => {
          const id = await begin(channel);
          started = id !== null;
          return id ?? "";
        }, onEvent);
        if (!started) {
          if (latest.current === run) setState({ status: "idle" });
          return false;
        }
        // Stopped (or superseded) before the backend answered: stop it now.
        if (run.cancelled || latest.current !== run) {
          void commands.cancelOperation(handle.id);
        } else {
          operation.current = handle.id;
        }
        const outcome = await handle.done;
        if (operation.current === handle.id) operation.current = null;
        if (latest.current !== run) return true;
        // The user stopped it, so they know; the backend skips it while odin-db has focus.
        if (title && outcome.status !== "cancelled") {
          void commands.notifyIfUnfocused(
            title,
            outcome.status === "failed"
              ? errorMessage(outcome.error.message)
              : i18n.t("operation.finished", { ns: "common" }),
          );
        }
        setState(
          outcome.status === "failed"
            ? { status: "failed", error: errorMessage(outcome.error.message) }
            : { status: outcome.status },
        );
      } catch (error) {
        if (latest.current === run) setState({ status: "failed", error: errorMessage(error) });
      }
      return true;
    },
    [title],
  );

  const cancel = useCallback(() => {
    if (latest.current) latest.current.cancelled = true;
    if (operation.current) void commands.cancelOperation(operation.current);
  }, []);

  const reset = useCallback(() => setState({ status: "idle" }), []);

  return { state, start, cancel, reset };
}
