import {
  type CompareProgress,
  commands,
  type JsonValue,
  type SyncEvent,
  type SyncSummary,
} from "@odin-db/bindings";
import { useState } from "react";
import { useOperation } from "@/hooks/use-operation";
import { call } from "@/lib/ipc";
import type { CompareSide } from "../lib/target";

export interface SyncOptions {
  insertMissing: boolean;
  replaceDifferent: boolean;
  deleteExtra: boolean;
}

/** Applies a comparison's differences to the right side, with progress. */
export function useSync() {
  const operation = useOperation<SyncEvent>();
  const [progress, setProgress] = useState<CompareProgress | null>(null);

  /** Resolves with what changed, or `null` when the sync was stopped or failed. */
  const start = async (
    left: CompareSide,
    right: CompareSide,
    filter: JsonValue | null,
    options: SyncOptions,
  ): Promise<SyncSummary | null> => {
    setProgress(null);
    let result: SyncSummary | null = null;
    await operation.start(
      (channel) =>
        call(
          commands.syncCollections(
            left.connectionId,
            right.connectionId,
            {
              compare: {
                left: { database: left.database, collection: left.collection },
                right: { database: right.database, collection: right.collection },
                filter,
              },
              ...options,
            },
            channel,
          ),
        ),
      (event) => {
        if (event.kind === "progress") setProgress(event.value);
        else result = event.value;
      },
    );
    return result;
  };

  return { ...operation, progress, start };
}
