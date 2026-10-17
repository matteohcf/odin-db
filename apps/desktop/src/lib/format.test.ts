import { describe, expect, it } from "vitest";
import { formatBytes, formatCount, formatRelativeTime } from "./format";

describe("format", () => {
  it("formats byte sizes with the largest fitting unit", () => {
    expect(formatBytes(0, "en")).toBe("0 byte");
    expect(formatBytes(1536, "en")).toBe("1.5 kB");
    expect(formatBytes(50 * 1024 * 1024, "en")).toBe("50 MB");
  });

  it("groups thousands", () => {
    expect(formatCount(20000, "en")).toBe("20,000");
  });

  it("formats recent times relative to now", () => {
    const now = Date.UTC(2026, 9, 17, 12);
    expect(formatRelativeTime(now - 10_000, now, "en")).toBe("now");
    expect(formatRelativeTime(now - 5 * 60_000, now, "en")).toBe("5 minutes ago");
    expect(formatRelativeTime(now - 26 * 3600_000, now, "en")).toBe("yesterday");
  });
});
