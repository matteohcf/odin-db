import type { IndexAdvice } from "@odin-db/bindings";

/** The mongosh command that creates the advised index, to run elsewhere or keep in a migration. */
export function createIndexCommand(
  advice: Pick<IndexAdvice, "database" | "collection">,
  keys: string,
) {
  return `db.getSiblingDB(${JSON.stringify(advice.database)}).getCollection(${JSON.stringify(advice.collection)}).createIndex(${keys})`;
}

/** 340 ms, 4.2 s, 3.5 min: total time spent by slow operations. */
export function formatMillis(millis: number, locale?: string) {
  const format = (value: number, unit: string) =>
    `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value)} ${unit}`;
  if (millis < 1000) return format(millis, "ms");
  if (millis < 60_000) return format(millis / 1000, "s");
  return format(millis / 60_000, "min");
}
