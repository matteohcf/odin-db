import { commands } from "@odin-db/bindings";
import { useQuery } from "@tanstack/react-query";
import { call } from "@/lib/ipc";

export function useToolsStatus() {
  return useQuery({
    queryKey: ["databaseTools"],
    queryFn: () => call(commands.databaseToolsStatus()),
    // Installing the tools while the app runs should be noticed on the next dialog.
    staleTime: 0,
  });
}
