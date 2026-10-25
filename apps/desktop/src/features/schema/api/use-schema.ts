import { type ConnectionId, commands, type EJsonDocument, type Namespace } from "@odin-db/bindings";
import { useQuery } from "@tanstack/react-query";
import { call } from "@/lib/ipc";

/** Larger than the autocompletion sample: the schema view is about accuracy. */
export const SCHEMA_SAMPLE = 1000;

/** The schema of a random sample of the collection, or of the documents matching `filter`. */
export function useSchema(
  connectionId: ConnectionId,
  namespace: Namespace,
  filter: EJsonDocument | null,
) {
  return useQuery({
    queryKey: [
      "connections",
      connectionId,
      "schema",
      namespace.database,
      namespace.collection,
      filter,
    ] as const,
    queryFn: () => call(commands.sampleFields(connectionId, namespace, SCHEMA_SAMPLE, filter)),
    staleTime: Number.POSITIVE_INFINITY,
  });
}
