import { type ConnectionId, commands, type Namespace } from "@odin-db/bindings";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { call } from "@/lib/ipc";
import { isWriteOperator } from "../lib/operators";
import { buildPipeline, type Stage, sampled } from "../lib/pipeline";

export const PREVIEW_LIMIT = 20;
export const PREVIEW_SAMPLE = 1000;

export class StageSyntaxError extends Error {
  override name = "StageSyntaxError";
  constructor(
    message: string,
    readonly stageId: string,
  ) {
    super(message);
  }
}

/**
 * First results after stage `index`, over a bounded sample of the collection.
 * Text changes are debounced; identical pipelines are served from the query cache.
 */
export function useStagePreview(
  connectionId: ConnectionId,
  namespace: Namespace,
  stages: readonly Stage[],
  index: number,
) {
  const upTo = stages.slice(0, index + 1);
  const current = stages[index];
  const previewable =
    current?.enabled === true && !upTo.some((s) => s.enabled && isWriteOperator(s.operator));
  const key = useDebouncedValue(
    JSON.stringify(upTo.filter((s) => s.enabled).map((s) => [s.id, s.operator, s.body])),
    400,
  );

  return useQuery({
    queryKey: [
      "aggregation",
      "preview",
      connectionId,
      namespace.database,
      namespace.collection,
      key,
    ],
    queryFn: async () => {
      const built = await buildPipeline(upTo);
      if (!built.ok) throw new StageSyntaxError(built.error, built.stageId);
      const first = upTo.find((s) => s.enabled)?.operator;
      return call(
        commands.previewAggregation(
          connectionId,
          namespace,
          sampled(built.pipeline, first, PREVIEW_SAMPLE),
          PREVIEW_LIMIT,
        ),
      );
    },
    enabled: previewable,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}
