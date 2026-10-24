import { type ConnectionId, commands, type EJsonDocument, type Namespace } from "@odin-db/bindings";
import { useQuery } from "@tanstack/react-query";
import { call } from "@/lib/ipc";

/** How many documents a write by filter is about to touch; never cached. */
export function useMatchingCount(
  connectionId: ConnectionId,
  namespace: Namespace,
  filter: EJsonDocument,
) {
  return useQuery({
    queryKey: ["bulk-count", connectionId, namespace, filter],
    queryFn: () => call(commands.countDocuments(connectionId, namespace, filter, null)),
    gcTime: 0,
  });
}
