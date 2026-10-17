import { commands } from "@odin-db/bindings";
import { useQuery } from "@tanstack/react-query";

export function useAppInfo() {
  return useQuery({
    queryKey: ["app", "info"],
    queryFn: () => commands.appInfo(),
    staleTime: Number.POSITIVE_INFINITY,
  });
}
