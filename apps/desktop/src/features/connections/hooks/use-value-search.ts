import {
  type ConnectionId,
  commands,
  type SearchEvent,
  type SearchHit,
  type SearchRequest,
  type SearchSummary,
  type SearchUpdate,
} from "@odin-db/bindings";
import { useState } from "react";
import { useOperation } from "@/hooks/use-operation";
import { call } from "@/lib/ipc";

type Scanning = Extract<SearchUpdate, { kind: "scanning" }>["value"];

/** One value search at a time: where it is, the hits so far, and the totals at the end. */
export function useValueSearch(connectionId: ConnectionId) {
  const operation = useOperation<SearchEvent>();
  const [scanning, setScanning] = useState<Scanning | null>(null);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [summary, setSummary] = useState<SearchSummary | null>(null);

  const start = (request: SearchRequest) => {
    setScanning(null);
    setHits([]);
    setSummary(null);
    return operation.start(
      (channel) => call(commands.searchValues(connectionId, request, channel)),
      (event) => {
        if (event.kind === "finished") setSummary(event.value);
        else if (event.value.kind === "scanning") setScanning(event.value.value);
        else {
          const batch = event.value.value;
          setHits((current) => [...current, ...batch]);
        }
      },
    );
  };

  return { ...operation, start, scanning, hits, summary };
}
