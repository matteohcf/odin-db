import {
  type CompareEvent,
  type CompareProgress,
  type CompareSummary,
  commands,
  type JsonValue,
} from "@odin-db/bindings";
import { useState } from "react";
import { useOperation } from "@/hooks/use-operation";
import { call } from "@/lib/ipc";
import type { CompareSide } from "../lib/target";

/** Runs one comparison at a time, keeping its progress and final counts. */
export function useCompare() {
  const operation = useOperation<CompareEvent>();
  const [progress, setProgress] = useState<CompareProgress | null>(null);
  const [summary, setSummary] = useState<CompareSummary | null>(null);

  const start = (left: CompareSide, right: CompareSide, filter: JsonValue | null) => {
    setProgress(null);
    setSummary(null);
    return operation.start(
      (channel) =>
        call(
          commands.compareCollections(
            left.connectionId,
            right.connectionId,
            {
              left: { database: left.database, collection: left.collection },
              right: { database: right.database, collection: right.collection },
              filter,
            },
            channel,
          ),
        ),
      (event) => (event.kind === "progress" ? setProgress(event.value) : setSummary(event.value)),
    );
  };

  return { ...operation, progress, summary, start };
}
