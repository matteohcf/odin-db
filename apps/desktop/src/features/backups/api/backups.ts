import {
  commands,
  events,
  type RunId,
  type ScheduleId,
  type ScheduleInput,
} from "@odin-db/bindings";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { call } from "@/lib/ipc";

const keys = {
  runs: ["backups", "runs"] as const,
  schedules: ["backups", "schedules"] as const,
};

export function useBackupRuns() {
  return useQuery({ queryKey: keys.runs, queryFn: () => call(commands.listBackupRuns()) });
}

export function useBackupSchedules() {
  return useQuery({
    queryKey: keys.schedules,
    queryFn: () => call(commands.listBackupSchedules()),
    // Next run times move as the clock does.
    refetchInterval: 60_000,
  });
}

/** Refreshes history and schedules whenever a backup starts or ends. */
export function useBackupEvents() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const unlisten = events.backupsChanged.listen(() => {
      void queryClient.invalidateQueries({ queryKey: ["backups"] });
    });
    return () => void unlisten.then((stop) => stop());
  }, [queryClient]);
}

function useBackupsMutation<T>(run: (input: T) => Promise<unknown>, handlesErrors = false) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    meta: { handlesErrors },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["backups"] }),
  });
}

export function useSaveSchedule() {
  return useBackupsMutation(
    (variables: { id: ScheduleId | null; input: ScheduleInput; folderToken: string | null }) =>
      call(commands.saveBackupSchedule(variables.id, variables.input, variables.folderToken)),
    true,
  );
}

export function useDeleteSchedule() {
  return useBackupsMutation((id: ScheduleId) => call(commands.deleteBackupSchedule(id)));
}

export function useRunScheduleNow() {
  return useBackupsMutation((id: ScheduleId) => call(commands.runBackupScheduleNow(id)));
}

export function useDeleteRun() {
  return useBackupsMutation((variables: { id: RunId; deleteArchive: boolean }) =>
    call(commands.deleteBackupRun(variables.id, variables.deleteArchive)),
  );
}
