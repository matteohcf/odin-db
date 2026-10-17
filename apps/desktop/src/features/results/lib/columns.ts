import type { CellData, RowData, TableFeatures } from "@tanstack/react-table";
import { describeEJson, type EJsonKind, type JsonObject } from "@/lib/ejson-display";

const SAMPLE_SIZE = 100;

/** The most frequent BSON type of a field among the first loaded documents. */
export function dominantKind(rows: readonly JsonObject[], key: string): EJsonKind | undefined {
  const counts = new Map<EJsonKind, number>();
  for (const row of rows.slice(0, SAMPLE_SIZE)) {
    const value = row[key];
    if (value === undefined) continue;
    const { kind } = describeEJson(value);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  let best: EJsonKind | undefined;
  let bestCount = 0;
  for (const [kind, count] of counts) {
    if (count > bestCount) {
      best = kind;
      bestCount = count;
    }
  }
  return best;
}

const widthByKind: Partial<Record<EJsonKind, number>> = {
  objectId: 214,
  date: 216,
  number: 120,
  boolean: 96,
  null: 96,
  document: 140,
  array: 140,
};

export function columnWidth(key: string, kind: EJsonKind | undefined): number {
  const byKind = (kind && widthByKind[kind]) ?? 200;
  // Room for the header label too.
  return Math.max(byKind, Math.min(key.length * 8 + 48, 280));
}

declare module "@tanstack/react-table" {
  interface ColumnMeta<
    TFeatures extends TableFeatures,
    TData extends RowData,
    TValue extends CellData,
  > {
    kind: EJsonKind | undefined;
  }
}
