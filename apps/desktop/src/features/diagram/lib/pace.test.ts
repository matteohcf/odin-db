import { describe, expect, it } from "vitest";
import { recommendPace } from "./pace";

const GB = 1024 ** 3;

describe("recommendPace", () => {
  it("scans small databases fast", () => {
    expect(recommendPace({ collections: 50, bytes: GB - 1 })).toBe("fast");
  });

  it("slows down for more collections or more data", () => {
    expect(recommendPace({ collections: 51, bytes: 0 })).toBe("balanced");
    expect(recommendPace({ collections: 0, bytes: GB })).toBe("balanced");
    expect(recommendPace({ collections: 299, bytes: 50 * GB - 1 })).toBe("balanced");
  });

  it("is gentle with large databases", () => {
    expect(recommendPace({ collections: 300, bytes: 0 })).toBe("gentle");
    expect(recommendPace({ collections: 0, bytes: 50 * GB })).toBe("gentle");
  });
});
