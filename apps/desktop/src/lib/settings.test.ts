import { describe, expect, it } from "vitest";
import { stepZoom } from "./settings";

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
