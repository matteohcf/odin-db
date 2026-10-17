import { type ConnectionId, commands, type Namespace } from "@odin-db/bindings";
import { useQuery } from "@tanstack/react-query";
import { call } from "@/lib/ipc";

const SAMPLE_SIZE = 200;

/** Field paths for autocompletion, from a sample of the collection. */
export function useSampleFields(connectionId: ConnectionId, namespace: Namespace) {
  return useQuery({
    queryKey: [
      "connections",
      connectionId,
      "fields",
      namespace.database,
      namespace.collection,
    ] as const,
    queryFn: () => call(commands.sampleFields(connectionId, namespace, SAMPLE_SIZE)),
    staleTime: 5 * 60_000,
  });
}
