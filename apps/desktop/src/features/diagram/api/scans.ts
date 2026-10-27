import { commands, type ProfileId, type ScanId } from "@odin-db/bindings";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { call } from "@/lib/ipc";

export const scanKeys = {
  all: ["diagram-scans"] as const,
  list: (profileId: ProfileId, database: string) =>
    [...scanKeys.all, "list", profileId, database] as const,
  scan: (id: ScanId) => [...scanKeys.all, "scan", id] as const,
};

/** Saved scans of a database, newest first: reading them never touches the server. */
export function useDiagramScans(profileId: ProfileId, database: string) {
  return useQuery({
    queryKey: scanKeys.list(profileId, database),
    queryFn: () => call(commands.listDiagramScans(profileId, database)),
  });
}

export function useDiagramScan(id: ScanId | null) {
  return useQuery({
    queryKey: scanKeys.scan(id ?? ""),
    queryFn: () => call(commands.getDiagramScan(id ?? "")),
    enabled: id !== null,
    // A saved scan never changes.
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useClearDiagramScans() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => call(commands.clearDiagramScans()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: scanKeys.all }),
  });
}
