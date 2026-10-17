import { type ConnectionId, commands, type ProfileId, type ProfileInput } from "@odin-db/bindings";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTabs } from "@/features/workspace";
import { call } from "@/lib/ipc";
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

export function useDeleteProfile() {
  const queryClient = useQueryClient();
  const closeForProfile = useTabs((s) => s.closeForProfile);
  return useMutation({
    mutationFn: (id: ProfileId) => call(commands.deleteProfile(id)),
    onSuccess: (_, id) => {
      closeForProfile(id);
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
