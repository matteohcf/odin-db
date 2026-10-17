import { type ConnectionId, commands, type Namespace } from "@odin-db/bindings";
import { useQuery } from "@tanstack/react-query";
import { call } from "@/lib/ipc";

export function useCollectionStats(
  connectionId: ConnectionId,
  namespace: Namespace,
  enabled: boolean,
) {
  return useQuery({
    queryKey: [
      "connections",
      connectionId,
      "stats",
      namespace.database,
      namespace.collection,
    ] as const,
    queryFn: () => call(commands.collectionStats(connectionId, namespace)),
    enabled,
    staleTime: 30_000,
  });
}
