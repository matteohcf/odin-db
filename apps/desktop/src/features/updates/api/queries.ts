import { commands } from "@odin-db/bindings";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { call } from "@/lib/ipc";

const updateCheckQuery = queryOptions({
  queryKey: ["update-check"],
  queryFn: () => call(commands.checkForUpdate()),
  // One check per session is enough; "Check now" refetches on demand.
  staleTime: Number.POSITIVE_INFINITY,
  retry: false,
});

/** The newer release, `null` when up to date; checks only while `enabled`. */
export function useUpdateCheck(enabled: boolean) {
  return useQuery({ ...updateCheckQuery, enabled });
}
