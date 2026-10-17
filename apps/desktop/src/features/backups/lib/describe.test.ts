import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";
import { clockTime, durationLabel, scopeLabel, timingLabel, weekdayName } from "./describe";

// Echoes the key and options, so the tests check which message is chosen.
const t = ((key: string, options?: Record<string, unknown>) =>
  `${key}${options ? ` ${JSON.stringify(options)}` : ""}`) as unknown as TFunction<"backups">;

describe("backup descriptions", () => {
  it("names scopes", () => {
    expect(scopeLabel({ kind: "deployment" }, t)).toBe("scope.deployment");
    expect(scopeLabel({ kind: "collection", database: "shop", collection: "orders" }, t)).toBe(
      'scope.collection {"namespace":"shop.orders"}',
    );
  });

  it("formats times, weekdays and durations", () => {
    expect(clockTime(125)).toBe("02:05");
    expect(weekdayName(1, "en")).toBe("Monday");
    expect(weekdayName(7, "en")).toBe("Sunday");
    expect(timingLabel({ frequency: "hourly", minute: 5, weekday: null }, t)).toBe(
      'timing.hourly {"minute":"05"}',
    );
    expect(durationLabel(4_200)).toBe("4 s");
    expect(durationLabel(65_000)).toBe("1 min 05 s");
    expect(durationLabel(3_720_000)).toBe("1 h 02 min");
  });
});
