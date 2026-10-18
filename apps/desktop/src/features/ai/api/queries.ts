import { commands } from "@odin-db/bindings";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { call } from "@/lib/ipc";

export const aiOverviewQuery = queryOptions({
  queryKey: ["ai", "overview"],
  queryFn: () => call(commands.aiOverview()),
});

/** The model catalog with what is on disk, and the machine it runs on. */
export function useAiOverview() {
  return useQuery(aiOverviewQuery);
}

/** Models installed in the Ollama at `url`; fetched only while `enabled`. */
export function useOllamaModels(url: string, enabled: boolean) {
  return useQuery({
    queryKey: ["ai", "ollama", url],
    queryFn: () => call(commands.listOllamaModels(url)),
    enabled: enabled && url.trim() !== "",
    retry: false,
  });
}
