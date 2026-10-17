import { commands } from "@odin-db/bindings";
import { useEffect, useState } from "react";
import { useStore } from "zustand";
import { call } from "@/lib/ipc";
import {
  createResultsController,
  type ResultsController,
  type ResultsState,
} from "../lib/results-controller";

/** A results controller owned by the calling component, released on unmount. */
export function useResultsController(): ResultsController {
  const [controller] = useState(() =>
    createResultsController({
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
