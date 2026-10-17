import { describe, expect, it } from "vitest";
import { formatBytes, formatCount } from "./format";

describe("format", () => {
  it("formats byte sizes with the largest fitting unit", () => {
    expect(formatBytes(0, "en")).toBe("0 byte");
    expect(formatBytes(1536, "en")).toBe("1.5 kB");
    expect(formatBytes(50 * 1024 * 1024, "en")).toBe("50 MB");
  });

  it("groups thousands", () => {
    expect(formatCount(20000, "en")).toBe("20,000");
  });
});
