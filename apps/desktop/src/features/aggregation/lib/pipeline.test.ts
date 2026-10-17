import { terminateWorker } from "@mongodb-js/shell-bson-parser";
import { afterAll, describe, expect, it } from "vitest";
import { buildPipeline, parseStage, pipelineToText, type Stage, sampled } from "./pipeline";

afterAll(() => terminateWorker());

const stage = (operator: string, body: string, enabled = true, id = operator): Stage => ({
  id,
  operator,
  body,
  enabled,
});

describe("pipeline", () => {
  it("parses stage arguments of any type", async () => {
    expect(await parseStage(stage("$limit", "10"))).toEqual({
      ok: true,
      stage: { $limit: { $numberInt: "10" } },
    });
    expect(await parseStage(stage("$unwind", '"$tags"'))).toEqual({
      ok: true,
      stage: { $unwind: "$tags" },
    });
    expect(await parseStage(stage("$match", ""))).toEqual({ ok: true, stage: { $match: {} } });
  });

  it("skips disabled stages and stops at the requested index", async () => {
    const stages = [stage("$match", "{ a: 1 }"), stage("$skip", "5", false), stage("$limit", "3")];
    expect(await buildPipeline(stages, 1)).toEqual({
      ok: true,
      pipeline: [{ $match: { a: { $numberInt: "1" } } }],
    });
    const all = await buildPipeline(stages);
    expect(all.ok && all.pipeline).toHaveLength(2);
  });

  it("reports the first stage with a syntax error", async () => {
    const stages = [stage("$match", "{ a: "), stage("$limit", "nope")];
    const result = await buildPipeline(stages);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.stageId).toBe("$match");
  });

  it("samples previews unless the first stage must stay first", () => {
    const pipeline = [{ $match: {} }];
    expect(sampled(pipeline, "$match", 1000)[0]).toEqual({ $limit: { $numberInt: "1000" } });
    expect(sampled(pipeline, "$geoNear", 1000)).toEqual(pipeline);
  });

  it("renders enabled stages as mongosh text", () => {
    const stages = [stage("$match", "{\n  a: 1\n}"), stage("$limit", "5", false)];
    expect(pipelineToText(stages)).toBe("[\n  {\n    $match: {\n      a: 1\n    }\n  }\n]");
    expect(pipelineToText([])).toBe("[]");
  });
});
