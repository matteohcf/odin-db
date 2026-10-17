import { type CollectionTab, useTabs } from "@/features/workspace";
import { useConnect } from "../api/mutations";
import { useConnections } from "../api/queries";

/** Opens a collection tab and connects its profile if needed, so it opens ready to query. */
export function useOpenCollection() {
  const openCollection = useTabs((s) => s.openCollection);
  const { data: connections = [] } = useConnections();
  const connect = useConnect();
  return (target: Omit<CollectionTab, "kind" | "id">) => {
    openCollection(target);
    if (!connections.some((connection) => connection.profileId === target.profileId)) {
      connect.mutate(target.profileId);
    }
  };
}
