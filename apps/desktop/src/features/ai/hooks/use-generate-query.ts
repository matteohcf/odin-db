import {
  commands,
  type EngineChoice,
  type FieldSummary,
  type GeneratedQuery,
} from "@odin-db/bindings";
import { useState } from "react";
import { useOperation } from "@/hooks/use-operation";
import { call } from "@/lib/ipc";
import { fieldHints } from "../lib/engine";

/** One generation at a time, stoppable; the latest query is kept until the next run. */
export function useGenerateQuery() {
  const operation = useOperation<GeneratedQuery>();
  const [query, setQuery] = useState<GeneratedQuery | null>(null);

  const generate = (
    engine: EngineChoice,
    prompt: string,
    collection: string,
    fields: readonly FieldSummary[],
  ) => {
    setQuery(null);
    return operation.start(
      (channel) =>
        call(
          commands.generateQuery(
            engine,
            { prompt, collection, fields: fieldHints(fields) },
            channel,
          ),
        ),
      setQuery,
    );
  };

  return { ...operation, query, generate };
}
