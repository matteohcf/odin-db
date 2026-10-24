import { describe, expect, it } from "vitest";
import { fitBox, panBox, project, zoomBox } from "./map-view";

describe("map view", () => {
  it("projects longitude and latitude into the map box", () => {
    expect(project(0, 0)).toEqual([180, 90]);
    expect(project(-180, 90)).toEqual([0, 0]);
  });

  it("fits the points with a margin, shaped like the screen", () => {
    const box = fitBox(
      [
        [9, 45],
        [12, 42],
      ],
      2,
    );
    expect(box.width / box.height).toBeCloseTo(2);
    expect(box.x).toBeLessThan(189);
    expect(box.x + box.width).toBeGreaterThan(192);
    expect(box.y).toBeLessThan(45);
    expect(box.y + box.height).toBeGreaterThan(48);
  });

  it("zooms around the point under the cursor", () => {
    const box = { x: 0, y: 0, width: 100, height: 50 };
    const closer = zoomBox(box, 2, [25, 25]);
    expect(closer).toEqual({ x: 12.5, y: 12.5, width: 50, height: 25 });
  });

  it("keeps part of the world on screen when panning", () => {
    const box = { x: 0, y: 0, width: 100, height: 50 };
    expect(panBox(box, -500, 0).x).toBe(-50);
    expect(panBox(box, 500, 0).x).toBe(310);
  });
});
