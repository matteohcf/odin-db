const UNITS = ["byte", "kilobyte", "megabyte", "gigabyte", "terabyte"] as const;

export function formatBytes(bytes: number, locale?: string): string {
  // Intl spells out "byte"; the abbreviation matches kB, MB and the rest.
  if (bytes < 1024) return `${new Intl.NumberFormat(locale).format(bytes)} B`;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: UNITS[unit],
    unitDisplay: "short",
    maximumFractionDigits: value < 10 && unit > 0 ? 1 : 0,
  }).format(value);
}

export function formatCount(count: number, locale?: string): string {
  return new Intl.NumberFormat(locale).format(count);
}

/** 1.2K, 3.4M: for tight spots like tree rows and tab badges. */
export function formatCompact(count: number, locale?: string): string {
  return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(
    count,
  );
}

const TIME_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

// Building an Intl formatter is far slower than formatting; grid cells format on every render.
const relativeFormats = new Map<string | undefined, Intl.RelativeTimeFormat>();
const dateTimeFormats = new Map<string | undefined, Intl.DateTimeFormat>();

/** "5 minutes ago", "yesterday"; anything under a minute is "now". */
export function formatRelativeTime(timestamp: number, now: number, locale?: string): string {
  let format = relativeFormats.get(locale);
  if (!format) {
    format = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "long" });
    relativeFormats.set(locale, format);
  }
  const seconds = (timestamp - now) / 1000;
  for (const [unit, size] of TIME_UNITS) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return format.format(0, "second");
}

/**
 * A date in local time, laid out like the UTC display so columns line up:
 * `2024-03-01 14:05:09.120 +01:00`.
 */
export function formatLocalDateTime(date: Date): string {
  const pad = (n: number, width = 2) => String(Math.abs(n)).padStart(width, "0");
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.` +
    `${pad(date.getMilliseconds(), 3)} ${sign}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}`
  );
}

const LOCALE_DATE_TIME: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
};

/** The date and time as `Date.toLocaleString` writes them, with a reused formatter. */
export function formatLocaleDateTime(date: Date, locale?: string): string {
  let format = dateTimeFormats.get(locale);
  if (!format) {
    format = new Intl.DateTimeFormat(locale, LOCALE_DATE_TIME);
    dateTimeFormats.set(locale, format);
  }
  return format.format(date);
}
