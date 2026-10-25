import type { JsonValue } from "@odin-db/bindings";
import { isJsonObject, type JsonObject } from "@/lib/ejson-display";
import { fieldPathsOf } from "@/lib/ejson-fields";

export type FieldRole = "number" | "date" | "category" | "geo";
export interface ChartField {
  path: string;
  role: FieldRole;
}

export type Aggregate = "sum" | "avg" | "min" | "max";
export interface ChartSpec {
  x: string;
  /** A numeric field, or `null` to count documents. */
  y: string | null;
  aggregate: Aggregate;
}

/** Bars of a category chart before the rest folds into "Other". */
export const MAX_BARS = 20;
const HISTOGRAM_BINS = 20;
const MAX_POINTS = 2000;

const ROLES: Record<string, FieldRole> = {
  int: "number",
  long: "number",
  double: "number",
  decimal: "number",
  date: "date",
  string: "category",
  bool: "category",
};

/**
 * Fields a chart can use, by what they hold in most documents. Arrays and documents cannot,
 * except GeoJSON points, which stand for a place rather than for their own fields.
 */
export function chartFields(rows: readonly JsonObject[]): ChartField[] {
  const summaries = fieldPathsOf(rows);
  const places = summaries
    .filter((field) => field.types[0] === "object" && isPlace(rows, field.path))
    .map((field) => field.path);
  const inPlace = (path: string) => places.some((place) => path.startsWith(`${place}.`));
  // Fields of documents inside arrays share the array's path (`items.sku`) but hold one value
  // per item: not something one bar or point can stand for.
  const arrays = summaries.filter((field) => field.types[0] === "array").map((field) => field.path);
  const inArray = (path: string) => arrays.some((array) => path.startsWith(`${array}.`));
  return summaries.flatMap((field): ChartField[] => {
    if (places.includes(field.path)) return [{ path: field.path, role: "geo" }];
    const role = ROLES[field.types[0] ?? ""];
    const usable = role && field.path !== "_id" && !inPlace(field.path) && !inArray(field.path);
    return usable ? [{ path: field.path, role }] : [];
  });
}

/** Most documents that have the field hold a GeoJSON point in it. */
function isPlace(rows: readonly JsonObject[], path: string): boolean {
  let present = 0;
  let points = 0;
  for (const row of rows.slice(0, 200)) {
    const value = valueAt(row, path);
    if (value === undefined) continue;
    present += 1;
    if (pointOf(value)) points += 1;
  }
  return present > 0 && points * 2 >= present;
}

/** `[longitude, latitude]` of a GeoJSON point. */
function pointOf(value: JsonValue | undefined): [number, number] | null {
  if (!isJsonObject(value) || value.type !== "Point" || !Array.isArray(value.coordinates))
    return null;
  const [lon, lat] = value.coordinates.map((coordinate) => numberOf(coordinate));
  if (lon == null || lat == null || Math.abs(lon) > 180 || Math.abs(lat) > 90) return null;
  return [lon, lat];
}

/** A starting chart: something over time if there is a date, else the first category. */
export function defaultSpec(fields: readonly ChartField[]): ChartSpec | null {
  const x =
    fields.find((field) => field.role === "date") ??
    fields.find((field) => field.role === "category") ??
    fields.find((field) => field.role === "number") ??
    fields.find((field) => field.role === "geo");
  return x ? { x: x.path, y: null, aggregate: "sum" } : null;
}

/** The value at a dotted path, through nested documents (not arrays). */
export function valueAt(document: JsonObject, path: string): JsonValue | undefined {
  let current: JsonValue | undefined = document;
  for (const key of path.split(".")) {
    if (!isJsonObject(current)) return undefined;
    current = current[key];
  }
  return current;
}

export function numberOf(value: JsonValue | undefined): number | null {
  if (typeof value === "number") return value;
  if (!isJsonObject(value)) return null;
  const raw = value.$numberInt ?? value.$numberLong ?? value.$numberDouble ?? value.$numberDecimal;
  if (typeof raw !== "string") return null;
  const number = Number(raw);
  return Number.isFinite(number) ? number : null;
}

function millisOf(value: JsonValue | undefined): number | null {
  if (!isJsonObject(value) || value.$date === undefined) return null;
  const inner = value.$date;
  const millis = isJsonObject(inner) ? Number(inner.$numberLong) : Date.parse(String(inner));
  return Number.isFinite(millis) ? millis : null;
}

function categoryOf(value: JsonValue | undefined): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return String(value);
  return null;
}

class Accumulator {
  count = 0;
  sum = 0;
  min = Number.POSITIVE_INFINITY;
  max = Number.NEGATIVE_INFINITY;
  /** Documents seen, whether or not they had a number to add. */
  documents = 0;

  add(value: number | null) {
    this.documents += 1;
    if (value === null) return;
    this.count += 1;
    this.sum += value;
    this.min = Math.min(this.min, value);
    this.max = Math.max(this.max, value);
  }

  merge(other: Accumulator) {
    this.documents += other.documents;
    this.count += other.count;
    this.sum += other.sum;
    this.min = Math.min(this.min, other.min);
    this.max = Math.max(this.max, other.max);
  }

  result(spec: ChartSpec): number | null {
    if (spec.y === null) return this.documents;
    if (this.count === 0) return spec.aggregate === "sum" ? 0 : null;
    switch (spec.aggregate) {
      case "sum":
        return this.sum;
      case "avg":
        return this.sum / this.count;
      case "min":
        return this.min;
      case "max":
        return this.max;
    }
  }
}

export interface ChartPoint {
  /** What the x axis shows: a category, a bucket's start (ms), a bin's lower bound, a value. */
  x: string | number;
  y: number | null;
  /** A histogram bin's upper bound. */
  to?: number;
  /** The document a map point stands for, by its position in the results. */
  row?: number;
  /** The bar folding the categories past the first ones. */
  other?: boolean;
}

export type TimeUnit = "hour" | "day" | "week" | "month" | "year";

export type ChartData =
  | { kind: "bar"; points: ChartPoint[]; missing: number }
  | { kind: "line"; unit: TimeUnit; points: ChartPoint[]; missing: number }
  | { kind: "histogram"; points: ChartPoint[]; missing: number }
  | { kind: "scatter"; points: ChartPoint[]; missing: number }
  | { kind: "map"; points: ChartPoint[]; missing: number };

/** The chart a spec describes, from documents loaded in the results. */
export function chartData(
  rows: readonly JsonObject[],
  role: FieldRole,
  spec: ChartSpec,
): ChartData {
  const yOf = (row: JsonObject) => (spec.y === null ? null : numberOf(valueAt(row, spec.y)));
  if (role === "geo") return places(rows, spec);
  if (role === "date") return timeSeries(rows, spec, yOf);
  if (role === "number") return spec.y === null ? histogram(rows, spec) : scatter(rows, spec, yOf);
  return categories(rows, spec, yOf);
}

function categories(
  rows: readonly JsonObject[],
  spec: ChartSpec,
  yOf: (row: JsonObject) => number | null,
): ChartData {
  const groups = new Map<string, Accumulator>();
  let missing = 0;
  for (const row of rows) {
    const key = categoryOf(valueAt(row, spec.x));
    if (key === null) {
      missing += 1;
      continue;
    }
    let group = groups.get(key);
    if (!group) {
      group = new Accumulator();
      groups.set(key, group);
    }
    group.add(yOf(row));
  }
  const ranked = [...groups].sort(([, a], [, b]) => (b.result(spec) ?? 0) - (a.result(spec) ?? 0));
  const points: ChartPoint[] = ranked
    .slice(0, MAX_BARS)
    .map(([x, group]) => ({ x, y: group.result(spec) }));
  // A long tail folds into one bar instead of an unreadable comb.
  const rest = ranked.slice(MAX_BARS);
  if (rest.length > 0) {
    const other = new Accumulator();
    for (const [, group] of rest) other.merge(group);
    points.push({ x: "", y: other.result(spec), other: true });
  }
  return { kind: "bar", points, missing };
}

/** Smallest and largest, without spreading thousands of arguments into `Math.min`. */
function range(values: readonly number[]): [number, number] {
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (value < low) low = value;
    if (value > high) high = value;
  }
  return [low, high];
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const UNITS: readonly [TimeUnit, number][] = [
  ["hour", HOUR],
  ["day", DAY],
  ["week", 7 * DAY],
  ["month", 30 * DAY],
  ["year", 365 * DAY],
];

/**
 * The finest unit that keeps the line readable: at most 120 buckets, and few enough that most
 * hold a document (about two per bucket), down to 12 buckets for small samples.
 */
function unitFor(span: number, count: number): TimeUnit {
  const most = Math.min(120, Math.max(12, count / 2));
  return UNITS.find(([, length]) => span / length <= most)?.[0] ?? "year";
}

/** The start of the UTC bucket a moment falls in. */
function bucket(millis: number, unit: TimeUnit): number {
  const date = new Date(millis);
  switch (unit) {
    case "hour":
      return Math.floor(millis / HOUR) * HOUR;
    case "day":
      return Math.floor(millis / DAY) * DAY;
    case "week":
      // Weeks start on Monday; 1 January 1970 was a Thursday.
      return (Math.floor((millis / DAY + 3) / 7) * 7 - 3) * DAY;
    case "month":
      return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
    case "year":
      return Date.UTC(date.getUTCFullYear(), 0, 1);
  }
}

function next(start: number, unit: TimeUnit): number {
  const date = new Date(start);
  switch (unit) {
    case "hour":
      return start + HOUR;
    case "day":
      return start + DAY;
    case "week":
      return start + 7 * DAY;
    case "month":
      return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
    case "year":
      return Date.UTC(date.getUTCFullYear() + 1, 0, 1);
  }
}

function timeSeries(
  rows: readonly JsonObject[],
  spec: ChartSpec,
  yOf: (row: JsonObject) => number | null,
): ChartData {
  const moments: [number, JsonObject][] = [];
  let missing = 0;
  for (const row of rows) {
    const millis = millisOf(valueAt(row, spec.x));
    if (millis === null) missing += 1;
    else moments.push([millis, row]);
  }
  if (moments.length === 0) return { kind: "line", unit: "day", points: [], missing };
  const [first, last] = range(moments.map(([millis]) => millis));
  const unit = unitFor(last - first, moments.length);
  const groups = new Map<number, Accumulator>();
  for (const [millis, row] of moments) {
    const start = bucket(millis, unit);
    let group = groups.get(start);
    if (!group) {
      group = new Accumulator();
      groups.set(start, group);
    }
    group.add(yOf(row));
  }
  // Every bucket in the range, so a quiet day reads as zero instead of being skipped.
  const points: ChartPoint[] = [];
  for (let start = bucket(first, unit); start <= last; start = next(start, unit)) {
    points.push({ x: start, y: groups.get(start)?.result(spec) ?? (spec.y === null ? 0 : null) });
  }
  return { kind: "line", unit, points, missing };
}

/** Float noise tolerated when placing a value on a bin edge, in bin widths. */
const EDGE = 1e-9;

/** The smallest 1, 2 or 5 times a power of ten that is at least `raw`. */
function niceStep(raw: number): number {
  const power = 10 ** Math.floor(Math.log10(raw));
  return ([1, 2, 5, 10].find((m) => m * power >= raw) ?? 10) * power;
}

/** Drops the float noise of adding steps (0.30000000000000004), keeping the step's precision. */
function round(value: number, step: number): number {
  const digits = Math.max(0, -Math.floor(Math.log10(step)));
  return Number(value.toFixed(digits));
}

function histogram(rows: readonly JsonObject[], spec: ChartSpec): ChartData {
  const values: number[] = [];
  for (const row of rows) {
    const value = numberOf(valueAt(row, spec.x));
    if (value !== null) values.push(value);
  }
  const missing = rows.length - values.length;
  if (values.length === 0) return { kind: "histogram", points: [], missing };
  const [low, high] = range(values);
  // Round bin edges (0–50, 50–100) rather than fractions of the range.
  // A range too wide for a double (±1e308) gets one bin instead of NaN edges.
  const finite = Number.isFinite(high - low);
  const width = finite ? niceStep((high - low) / HISTOGRAM_BINS || 1) : 1;
  const start = finite ? Math.floor(low / width) * width : low;
  const bins = finite ? Math.floor((high - start) / width + EDGE) + 1 : 1;
  const counts = new Array<number>(bins).fill(0);
  for (const value of values) {
    // A value on an edge (0.3 with 0.1 steps reads 2.9999…) belongs to the bin it starts.
    const index = Math.min(Math.floor((value - start) / width + EDGE), bins - 1);
    counts[index] = (counts[index] ?? 0) + 1;
  }
  const points = counts.map((count, index) => ({
    x: round(start + index * width, width),
    to: round(start + (index + 1) * width, width),
    y: count,
  }));
  return { kind: "histogram", points, missing };
}

function scatter(
  rows: readonly JsonObject[],
  spec: ChartSpec,
  yOf: (row: JsonObject) => number | null,
): ChartData {
  const points: ChartPoint[] = [];
  for (const row of rows) {
    const x = numberOf(valueAt(row, spec.x));
    const y = yOf(row);
    if (x !== null && y !== null) points.push({ x, y });
  }
  const missing = rows.length - points.length;
  return { kind: "scatter", points: points.slice(0, MAX_POINTS), missing };
}

/** Each document's point, longitude as x and latitude as y. */
function places(rows: readonly JsonObject[], spec: ChartSpec): ChartData {
  const points: ChartPoint[] = [];
  rows.forEach((row, index) => {
    const point = pointOf(valueAt(row, spec.x));
    if (point) points.push({ x: point[0], y: point[1], row: index });
  });
  return { kind: "map", points, missing: rows.length - points.length };
}
