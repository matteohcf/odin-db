import { commands } from "@odin-db/bindings";
import { useQuery } from "@tanstack/react-query";
import { call } from "@/lib/ipc";

export const mongoshStatusKey = ["mongosh"] as const;

export function useMongoshStatus() {
  return useQuery({
    queryKey: mongoshStatusKey,
    queryFn: () => call(commands.mongoshStatus()),
    staleTime: 0,
  });
}
