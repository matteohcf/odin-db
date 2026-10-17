import type { EJsonDocument } from "@odin-db/bindings";
import { parseShellDocument } from "@/lib/shell-syntax";
import { mustBeFirst } from "./operators";

export interface Stage {
  id: string;
  operator: string;
  /** The operator's argument in mongosh syntax, e.g. `{ status: "paid" }` or `10`. */
  body: string;
  enabled: boolean;
}

export type StageResult = { ok: true; stage: EJsonDocument } | { ok: false; error: string };

/** Parses one stage as `{ <operator>: <body> }` so any argument type works (numbers, strings…). */
export async function parseStage(stage: Pick<Stage, "operator" | "body">): Promise<StageResult> {
  const body = stage.body.trim() === "" ? "{}" : stage.body;
  try {
    return { ok: true, stage: await parseShellDocument(`{ ${stage.operator}: ${body}\n}`) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export type BuiltPipeline =
  | { ok: true; pipeline: EJsonDocument[] }
  | { ok: false; stageId: string; error: string };

/** The enabled stages up to and including `throughIndex`, parsed; stops at the first error. */
export async function buildPipeline(
  stages: readonly Stage[],
  throughIndex = stages.length - 1,
): Promise<BuiltPipeline> {
  const pipeline: EJsonDocument[] = [];
  for (const stage of stages.slice(0, throughIndex + 1)) {
    if (!stage.enabled) continue;
    const result = await parseStage(stage);
    if (!result.ok) return { ok: false, stageId: stage.id, error: result.error };
    pipeline.push(result.stage);
  }
  return { ok: true, pipeline };
}

/** Prepends a `$limit` so previews read a bounded sample, unless the first stage forbids it. */
export function sampled(
  pipeline: EJsonDocument[],
  firstOperator: string | undefined,
  size: number,
): EJsonDocument[] {
  if (firstOperator && mustBeFirst(firstOperator)) return pipeline;
  return [{ $limit: { $numberInt: String(size) } }, ...pipeline];
}

/** The pipeline as mongosh text, for copying into a shell or a driver. */
export function pipelineToText(stages: readonly Stage[]): string {
  const enabled = stages.filter((stage) => stage.enabled);
  if (enabled.length === 0) return "[]";
  const indent = (text: string) => text.trim().replaceAll("\n", "\n    ");
  return `[\n${enabled.map((s) => `  {\n    ${s.operator}: ${indent(s.body || "{}")}\n  }`).join(",\n")}\n]`;
}
