import {
  type ConnectionId,
  type CreateIndexRequest,
  commands,
  type Namespace,
} from "@odin-db/bindings";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { call } from "@/lib/ipc";

const indexKeys = (connectionId: ConnectionId, namespace: Namespace) =>
  ["connections", connectionId, "indexes", namespace.database, namespace.collection] as const;

export function useIndexes(connectionId: ConnectionId, namespace: Namespace) {
  return useQuery({
    queryKey: indexKeys(connectionId, namespace),
    queryFn: () => call(commands.listIndexes(connectionId, namespace)),
  });
}

export function useCreateIndex(connectionId: ConnectionId, namespace: Namespace) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: CreateIndexRequest) =>
      call(commands.createIndex(connectionId, namespace, request)),
    meta: { handlesErrors: true },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: indexKeys(connectionId, namespace) }),
  });
}

export function useDropIndex(connectionId: ConnectionId, namespace: Namespace) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => call(commands.dropIndex(connectionId, namespace, name)),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: indexKeys(connectionId, namespace) }),
  });
}

export function useSetIndexHidden(connectionId: ConnectionId, namespace: Namespace) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, hidden }: { name: string; hidden: boolean }) =>
      call(commands.setIndexHidden(connectionId, namespace, name, hidden)),
    meta: { handlesErrors: true },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: indexKeys(connectionId, namespace) }),
  });
}
