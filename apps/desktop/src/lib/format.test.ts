import { describe, expect, it } from "vitest";
import { formatBytes, formatCount, formatLocalDateTime, formatRelativeTime } from "./format";

describe("format", () => {
  it("formats byte sizes with the largest fitting unit", () => {
    expect(formatBytes(0, "en")).toBe("0 B");
    expect(formatBytes(390, "en")).toBe("390 B");
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

  it("formats local date-times with their offset", () => {
    const date = new Date(2024, 2, 1, 14, 5, 9, 120);
    const offset = -date.getTimezoneOffset();
    const sign = offset >= 0 ? "+" : "-";
    const hours = String(Math.trunc(Math.abs(offset) / 60)).padStart(2, "0");
    const minutes = String(Math.abs(offset) % 60).padStart(2, "0");
    expect(formatLocalDateTime(date)).toBe(`2024-03-01 14:05:09.120 ${sign}${hours}:${minutes}`);
  });
});
