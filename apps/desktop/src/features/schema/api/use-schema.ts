import { type ConnectionId, commands, type Namespace } from "@odin-db/bindings";
import { useQuery } from "@tanstack/react-query";
import { call } from "@/lib/ipc";

/** Larger than the autocompletion sample: the schema view is about accuracy. */
export const SCHEMA_SAMPLE = 1000;

export function useSchema(connectionId: ConnectionId, namespace: Namespace) {
  return useQuery({
    queryKey: [
      "connections",
      connectionId,
      "schema",
      namespace.database,
      namespace.collection,
    ] as const,
    queryFn: () => call(commands.sampleFields(connectionId, namespace, SCHEMA_SAMPLE)),
    staleTime: Number.POSITIVE_INFINITY,
  });
}
