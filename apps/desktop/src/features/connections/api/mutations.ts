import {
  type ConnectionId,
  commands,
  type Namespace,
  type ProfileId,
  type ProfileInput,
} from "@odin-db/bindings";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTabs } from "@/features/workspace";
import { call } from "@/lib/ipc";
import { useFavorites } from "../store/favorites-store";
import { connectionKeys } from "./keys";

export function useSaveProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: ProfileId; input: ProfileInput }) =>
      call(id ? commands.updateProfile(id, input) : commands.createProfile(input)),
    meta: { handlesErrors: true },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: connectionKeys.profiles }),
  });
}

export function useDuplicateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: ProfileId; name: string }) =>
      call(commands.duplicateProfile(id, name)),
    meta: { handlesErrors: true },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: connectionKeys.profiles }),
  });
}

export function useImportConnections() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => call(commands.importConnections()),
    meta: { handlesErrors: true },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: connectionKeys.profiles }),
  });
}

export function useExportConnections() {
  return useMutation({
    mutationFn: (ids: ProfileId[]) => call(commands.exportConnections(ids)),
    meta: { handlesErrors: true },
  });
}

export function useDeleteProfile() {
  const queryClient = useQueryClient();
  const closeForProfile = useTabs((s) => s.closeForProfile);
  const forgetFavorites = useFavorites((s) => s.forgetProfile);
  return useMutation({
    mutationFn: (id: ProfileId) => call(commands.deleteProfile(id)),
    onSuccess: (_, id) => {
      closeForProfile(id);
      forgetFavorites(id);
      void queryClient.invalidateQueries({ queryKey: connectionKeys.profiles });
      void queryClient.invalidateQueries({ queryKey: connectionKeys.connections });
    },
  });
}

export function useTestConnection() {
  return useMutation({
    mutationFn: ({ input, profileId }: { input: ProfileInput; profileId?: ProfileId }) =>
      call(commands.testConnection(input, profileId ?? null)),
    meta: { handlesErrors: true },
  });
}

export function useConnect() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (profileId: ProfileId) => call(commands.connect(profileId)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: connectionKeys.connections }),
  });
}

export function useDisconnect() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (connectionId: ConnectionId) => call(commands.disconnect(connectionId)),
    onSuccess: (_, connectionId) => {
      queryClient.removeQueries({ queryKey: connectionKeys.connection(connectionId) });
      void queryClient.invalidateQueries({ queryKey: connectionKeys.connections, exact: true });
    },
  });
}

/** Catalog changes refresh everything cached for the connection: tree, fields, indexes. */
function useCatalogMutation<T>(connectionId: ConnectionId, run: (input: T) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    meta: { handlesErrors: true },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: connectionKeys.connection(connectionId) }),
  });
}

export function useCreateCollection(connectionId: ConnectionId) {
  return useCatalogMutation(connectionId, (namespace: Namespace) =>
    call(commands.createCollection(connectionId, namespace)),
  );
}

export function useRenameCollection(connectionId: ConnectionId) {
  return useCatalogMutation(
    connectionId,
    ({ namespace, newName }: { namespace: Namespace; newName: string }) =>
      call(commands.renameCollection(connectionId, namespace, newName)),
  );
}

export function useDropCollection(connectionId: ConnectionId) {
  return useCatalogMutation(connectionId, (namespace: Namespace) =>
    call(commands.dropCollection(connectionId, namespace)),
  );
}

export function useDropDatabase(connectionId: ConnectionId) {
  return useCatalogMutation(connectionId, (database: string) =>
    call(commands.dropDatabase(connectionId, database)),
  );
}
