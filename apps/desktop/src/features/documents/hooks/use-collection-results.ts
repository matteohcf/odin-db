import { type ConnectionId, commands, type Namespace } from "@odin-db/bindings";
import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { AppError, call } from "@/lib/ipc";
import {
  createResultsController,
  type ResultsController,
  type ResultsState,
} from "../lib/results-controller";

/**
 * One results controller per collection tab, bound to the current connection.
 * The connection id is read at call time, so a reconnect keeps the same tab working.
 */
export function useCollectionResults(connectionId: ConnectionId | undefined, namespace: Namespace) {
  const target = useRef({ connectionId, namespace });
  target.current = { connectionId, namespace };

  const [controller] = useState(() =>
    createResultsController({
      find: (request) => {
        const { connectionId, namespace } = target.current;
        if (!connectionId) {
          return Promise.reject(new AppError({ kind: "notConnected", message: "Not connected" }));
        }
        return call(commands.findDocuments(connectionId, namespace, request));
      },
      fetchMore: (cursorId, batchSize) => call(commands.fetchMoreDocuments(cursorId, batchSize)),
      close: (cursorId) => void commands.closeCursor(cursorId),
    }),
  );

  useEffect(() => () => controller.dispose(), [controller]);
  return controller;
}

export function useResultsState<T>(
  controller: ResultsController,
  selector: (state: ResultsState) => T,
): T {
  return useStore(controller.store, selector);
}
