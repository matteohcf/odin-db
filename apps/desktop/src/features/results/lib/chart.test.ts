import { describe, expect, it } from "vitest";
import type { JsonObject } from "@/lib/ejson-display";
import { chartData, chartFields, defaultSpec, MAX_BARS, numberOf, valueAt } from "./chart";

const int = (value: number) => ({ $numberInt: String(value) });
const date = (iso: string) => ({ $date: { $numberLong: String(Date.parse(iso)) } });
const orders: JsonObject[] = [
  { _id: { $oid: "a".repeat(24) }, status: "paid", total: int(10), at: date("2026-01-01T10:00Z") },
  { status: "paid", total: { $numberDouble: "5.5" }, at: date("2026-01-03T10:00Z") },
  { status: "open", total: int(7), at: date("2026-01-03T12:00Z"), shipping: { city: "Rome" } },
  { total: int(1) },
];

describe("chartFields", () => {
  it("keeps numbers, dates and categories, not _id", () => {
    const fields = chartFields(orders).sort((a, b) => a.path.localeCompare(b.path));
    expect(fields).toEqual([
      { path: "at", role: "date" },
      { path: "shipping.city", role: "category" },
      { path: "status", role: "category" },
      { path: "total", role: "number" },
    ]);
  });

  it("leaves out fields inside arrays, which hold one value per item", () => {
    const rows = [{ items: [{ sku: "a" }, { sku: "b" }], total: int(3) }];
    expect(chartFields(rows).map((field) => field.path)).toEqual(["total"]);
  });

  it("starts from a date when there is one", () => {
    expect(defaultSpec(chartFields(orders))?.x).toBe("at");
  });
});

describe("values", () => {
  it("reads nested paths and every EJSON number", () => {
    expect(valueAt(orders[2] as JsonObject, "shipping.city")).toBe("Rome");
    expect(numberOf({ $numberLong: "12" })).toBe(12);
    expect(numberOf({ $numberDecimal: "1.25" })).toBe(1.25);
    expect(numberOf("12")).toBeNull();
  });
});

describe("chartData", () => {
  it("counts or sums by category, missing values set aside", () => {
    expect(chartData(orders, "category", { x: "status", y: null, aggregate: "sum" })).toEqual({
      kind: "bar",
      points: [
        { x: "paid", y: 2 },
        { x: "open", y: 1 },
      ],
      missing: 1,
    });
    const sums = chartData(orders, "category", { x: "status", y: "total", aggregate: "sum" });
    expect(sums.points).toEqual([
      { x: "paid", y: 15.5 },
      { x: "open", y: 7 },
    ]);
  });

  it("folds a long tail into Other", () => {
    const rows = Array.from({ length: MAX_BARS + 5 }, (_, i) => ({ name: `n${i}` }));
    const data = chartData(rows, "category", { x: "name", y: null, aggregate: "sum" });
    expect(data.points).toHaveLength(MAX_BARS + 1);
    expect(data.points.at(-1)).toEqual({ x: "", y: 5, other: true });
  });

  it("buckets dates and fills the quiet ones", () => {
    const data = chartData(orders, "date", { x: "at", y: null, aggregate: "sum" });
    expect(data.kind === "line" && data.unit).toBe("day");
    expect(data.points.map((point) => point.y)).toEqual([1, 0, 2]);
    const averages = chartData(orders, "date", { x: "at", y: "total", aggregate: "avg" });
    expect(averages.points.map((point) => point.y)).toEqual([10, null, 6.25]);
  });

  it("picks coarser buckets for sparse dates", () => {
    const day = 86_400_000;
    const monday = Date.UTC(2026, 0, 5);
    // 100 documents over 10 weeks: days would leave most buckets empty, weeks do not.
    const rows = Array.from({ length: 100 }, (_, i) => ({
      at: { $date: { $numberLong: String(monday + Math.floor((i * 70) / 100) * day) } },
    }));
    const data = chartData(rows, "date", { x: "at", y: null, aggregate: "sum" });
    expect(data.kind === "line" && data.unit).toBe("week");
    expect(data.points).toHaveLength(10);
    expect(data.points[0]?.x).toBe(monday);
    expect(data.points.reduce((sum, point) => sum + (point.y ?? 0), 0)).toBe(100);
    // The same span with many documents keeps daily detail.
    const dense = Array.from({ length: 400 }, (_, i) => ({
      at: { $date: { $numberLong: String(monday + Math.floor((i * 70) / 400) * day) } },
    }));
    const daily = chartData(dense, "date", { x: "at", y: null, aggregate: "sum" });
    expect(daily.kind === "line" && daily.unit).toBe("day");
  });

  it("bins numbers when counting, plots them against another number otherwise", () => {
    const data = chartData(orders, "number", { x: "total", y: null, aggregate: "sum" });
    expect(data.kind).toBe("histogram");
    expect(data.points.reduce((sum, point) => sum + (point.y ?? 0), 0)).toBe(4);
    expect(data.points.at(-1)).toMatchObject({ x: 10, to: 10.5, y: 1 });
    // Round edges, whatever the range.
    const totals = [3.2, 45.6, 893.9].map((total) => ({ total: { $numberDouble: String(total) } }));
    const bins = chartData(totals, "number", { x: "total", y: null, aggregate: "sum" }).points;
    expect(bins[0]).toMatchObject({ x: 0, to: 50, y: 2 });
    expect(bins.at(-1)).toMatchObject({ x: 850, to: 900, y: 1 });
    expect(bins).toHaveLength(18);
    const scatter = chartData(orders, "number", { x: "total", y: "total", aggregate: "sum" });
    expect(scatter.points).toContainEqual({ x: 7, y: 7 });
  });
});

describe("places", () => {
  const point = (lon: number, lat: number) => ({
    type: "Point",
    coordinates: [{ $numberDouble: String(lon) }, { $numberInt: String(lat) }],
  });
  const stores: JsonObject[] = [
    { name: "Duomo", location: point(9.19, 45) },
    { name: "Colosseo", location: point(12.49, 41) },
    { name: "Online" },
  ];

  it("takes a GeoJSON point field as a place, not as its parts", () => {
    expect(chartFields(stores)).toContainEqual({ path: "location", role: "geo" });
    expect(chartFields(stores).some((field) => field.path.startsWith("location."))).toBe(false);
  });

  it("puts each document with a point on the map", () => {
    const data = chartData(stores, "geo", { x: "location", y: null, aggregate: "sum" });
    expect(data).toEqual({
      kind: "map",
      points: [
        { x: 9.19, y: 45, row: 0 },
        { x: 12.49, y: 41, row: 1 },
      ],
      missing: 1,
    });
  });
});
