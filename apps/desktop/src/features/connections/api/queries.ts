import { type ConnectionId, commands, type ProfileId } from "@odin-db/bindings";
import { useQuery } from "@tanstack/react-query";
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
function useConnections() {
  return useQuery({
    queryKey: connectionKeys.connections,
    queryFn: () => call(commands.listConnections()),
  });
}

export function useConnectionOf(profileId: ProfileId) {
  const { data } = useConnections();
  return data?.find((connection) => connection.profileId === profileId);
}

export function useDatabases(connectionId: ConnectionId | undefined) {
  return useQuery({
    queryKey: connectionKeys.databases(connectionId ?? "none"),
    queryFn: () => call(commands.listDatabases(connectionId ?? "")),
    enabled: connectionId !== undefined,
  });
}

export function useCollections(connectionId: ConnectionId, database: string, enabled: boolean) {
  return useQuery({
    queryKey: connectionKeys.collections(connectionId, database),
    queryFn: () => call(commands.listCollections(connectionId, database)),
    enabled,
  });
}
