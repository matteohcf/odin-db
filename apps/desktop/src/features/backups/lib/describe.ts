import type { BackupScope, Timing } from "@odin-db/bindings";
import type { TFunction } from "i18next";

type Translate = TFunction<"backups">;

export function scopeLabel(scope: BackupScope, t: Translate): string {
  switch (scope.kind) {
    case "deployment":
      return t("scope.deployment");
    case "database":
      return t("scope.database", { database: scope.database });
    case "collection":
      return t("scope.collection", { namespace: `${scope.database}.${scope.collection}` });
  }
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "02:00" from minutes after midnight. */
export function clockTime(minute: number): string {
  return `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;
}

/** Localized weekday name; 1 = Monday … 7 = Sunday. */
export function weekdayName(weekday: number, locale?: string): string {
  // 2024-01-01 was a Monday.
  return new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(2024, 0, weekday)),
  );
}

export function timingLabel(timing: Timing, t: Translate, locale?: string): string {
  switch (timing.frequency) {
    case "hourly":
      return t("timing.hourly", { minute: pad(timing.minute) });
    case "daily":
      return t("timing.daily", { time: clockTime(timing.minute) });
    case "weekly":
      return t("timing.weekly", {
        day: weekdayName(timing.weekday ?? 1, locale),
        time: clockTime(timing.minute),
      });
  }
}

/** "1 min 05 s" style durations for the history. */
export function durationLabel(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ${pad(seconds % 60)} s`;
  return `${Math.floor(minutes / 60)} h ${pad(minutes % 60)} min`;
}
