import { commands } from "@odin-db/bindings";
import { useQuery } from "@tanstack/react-query";

export function useAutorunEnabled() {
  return useQuery({
    queryKey: ["perfLab", "autorun"],
    queryFn: () => commands.perfAutorunEnabled(),
    staleTime: Number.POSITIVE_INFINITY,
  });
}
