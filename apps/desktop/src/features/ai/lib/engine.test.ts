import type { FieldSummary } from "@odin-db/bindings";
import { describe, expect, it } from "vitest";
import { engineFrom, fieldHints } from "./engine";

const base = {
  aiEnabled: true,
  aiEngine: "local" as const,
  aiLocalModel: "qwen2.5-coder-1.5b",
  aiOllamaUrl: "http://localhost:11434",
  aiOllamaModel: "",
};

describe("engineFrom", () => {
  it("picks the configured engine", () => {
    expect(engineFrom(base)).toEqual({ kind: "local", model: "qwen2.5-coder-1.5b" });
    expect(engineFrom({ ...base, aiEngine: "ollama", aiOllamaModel: "qwen3:4b" })).toEqual({
      kind: "ollama",
      url: "http://localhost:11434",
      model: "qwen3:4b",
    });
  });

  it("is null when off or not set up", () => {
    expect(engineFrom({ ...base, aiEnabled: false })).toBeNull();
    expect(engineFrom({ ...base, aiLocalModel: "" })).toBeNull();
    expect(engineFrom({ ...base, aiEngine: "ollama" })).toBeNull();
  });
});

describe("fieldHints", () => {
  it("drops sampled values", () => {
    const fields: FieldSummary[] = [
      { path: "status", types: ["string"], frequency: 1, values: ["active", "banned"] },
    ];
    const hints = fieldHints(fields);
    expect(hints).toEqual([{ path: "status", types: ["string"] }]);
    expect(JSON.stringify(hints)).not.toContain("active");
  });
});
