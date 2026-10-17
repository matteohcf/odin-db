import { type ConnectionId, commands, type ProfileId } from "@odin-db/bindings";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { call } from "@/lib/ipc";
import { connectionKeys } from "./keys";

export function useProfiles() {
  return useQuery({
    queryKey: connectionKeys.profiles,
    queryFn: () => call(commands.listProfiles()),
  });
}

export function useProfile(profileId: ProfileId) {
  const { data } = useProfiles();
  return data?.find((profile) => profile.id === profileId);
}

/** Open connections live in the backend; the UI only mirrors them (ADR-0008). */
export function useConnections() {
  return useQuery({
    queryKey: connectionKeys.connections,
    queryFn: () => call(commands.listConnections()),
  });
}

export function useConnectionOf(profileId: ProfileId) {
  const { data } = useConnections();
  return data?.find((connection) => connection.profileId === profileId);
}

export const databasesQuery = (connectionId: ConnectionId) =>
  queryOptions({
    queryKey: connectionKeys.databases(connectionId),
    queryFn: () => call(commands.listDatabases(connectionId)),
  });

export const collectionsQuery = (connectionId: ConnectionId, database: string) =>
  queryOptions({
    queryKey: connectionKeys.collections(connectionId, database),
    queryFn: () => call(commands.listCollections(connectionId, database)),
  });

/** Estimated document counts, shown next to collections; refreshed with the tree. */
export function useCollectionCounts(
  connectionId: ConnectionId,
  database: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: connectionKeys.counts(connectionId, database),
    queryFn: async () => {
      const counts = await call(commands.collectionCounts(connectionId, database));
      return new Map(counts.map((entry) => [entry.name, entry.count ?? 0]));
    },
    enabled,
    staleTime: 30_000,
  });
}

export function useCollections(connectionId: ConnectionId, database: string, enabled: boolean) {
  return useQuery({ ...collectionsQuery(connectionId, database), enabled });
}
