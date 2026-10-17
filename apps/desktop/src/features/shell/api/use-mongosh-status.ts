import { commands } from "@odin-db/bindings";
import { useQuery } from "@tanstack/react-query";
import { call } from "@/lib/ipc";

export function useMongoshStatus() {
  return useQuery({
    queryKey: ["mongosh"],
    queryFn: () => call(commands.mongoshStatus()),
    staleTime: 0,
  });
}
