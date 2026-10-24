import { describe, expect, it } from "vitest";
import { stepZoom, useSettings, withTimeLimit } from "./settings";

describe("stepZoom", () => {
  it("moves between levels and stops at the ends", () => {
    expect(stepZoom(100, 1)).toBe(110);
    expect(stepZoom(100, -1)).toBe(90);
    expect(stepZoom(150, 1)).toBe(150);
    expect(stepZoom(80, -1)).toBe(80);
  });

  it("snaps an off-step zoom to its neighbours", () => {
    expect(stepZoom(105, 1)).toBe(110);
    expect(stepZoom(105, -1)).toBe(100);
  });
});

describe("withTimeLimit", () => {
  it("adds the time limit from settings unless the query sets its own", () => {
    useSettings.getState().update({ queryTimeLimitSeconds: 30 });
    expect(withTimeLimit()).toEqual({ maxTimeMs: 30_000 });
    expect(withTimeLimit({ maxTimeMs: 0 })).toEqual({ maxTimeMs: 0 });
    useSettings.getState().update({ queryTimeLimitSeconds: 0 });
    expect(withTimeLimit({ hint: "a_1" })).toEqual({ hint: "a_1" });
  });
});
