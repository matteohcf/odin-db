import type { ConnectionId, FieldSummary, Namespace } from "@odin-db/bindings";
import { useMemo } from "react";
import { useSampleFields } from "@/hooks/use-sample-fields";
import type { JsonObject } from "@/lib/ejson-display";
import { fieldPathsOf } from "@/lib/ejson-fields";
import type { Stage } from "../lib/pipeline";
import { useStagePreview } from "./use-stage-preview";

const NO_FIELDS: FieldSummary[] = [];

/**
 * The fields a stage receives: the previous enabled stage's preview output, or a
 * sample of the collection for the first stage. Both come from cached queries.
 */
export function useStageInputFields(
  connectionId: ConnectionId,
  namespace: Namespace,
  stages: readonly Stage[],
  index: number,
): readonly FieldSummary[] {
  const previous = stages.slice(0, index).findLastIndex((stage) => stage.enabled);
  const sample = useSampleFields(connectionId, namespace);
  const preview = useStagePreview(connectionId, namespace, stages, previous);
  const output = previous >= 0 ? preview.data : undefined;

  return useMemo(() => {
    if (previous < 0) return sample.data ?? NO_FIELDS;
    // Until the previous stage has a preview, the collection's fields are the best guess.
    return output ? fieldPathsOf(output as JsonObject[]) : (sample.data ?? NO_FIELDS);
  }, [previous, output, sample.data]);
}
