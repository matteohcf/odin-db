import { beforeEach, describe, expect, it } from "vitest";
import { pipelineKey, useSavedPipelines } from "./saved-pipelines-store";

const key = pipelineKey("p", "shop", "orders");
const stage = (operator: string) => ({
  id: crypto.randomUUID(),
  operator,
  body: "{}",
  enabled: true,
});
const saved = () => useSavedPipelines.getState().pipelines[key] ?? [];

describe("saved pipelines", () => {
  beforeEach(() => useSavedPipelines.setState({ pipelines: {} }));

  it("saves without stage ids and replaces a pipeline with the same name", () => {
    const { save } = useSavedPipelines.getState();
    save(key, "Revenue", [stage("$match")]);
    save(key, "Top customers", [stage("$group")]);
    save(key, "Revenue", [stage("$match"), stage("$sort")]);
    expect(saved().map((p) => p.name)).toEqual(["Revenue", "Top customers"]);
    expect(saved()[0]?.stages).toEqual([
      { operator: "$match", body: "{}", enabled: true },
      { operator: "$sort", body: "{}", enabled: true },
    ]);
  });

  it("removes by name", () => {
    const { save, remove } = useSavedPipelines.getState();
    save(key, "Revenue", [stage("$match")]);
    remove(key, "Revenue");
    expect(saved()).toEqual([]);
  });
});
