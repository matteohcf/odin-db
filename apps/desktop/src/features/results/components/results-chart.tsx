import { Button } from "@odin-db/ui/components/button";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@odin-db/ui/components/chart";
import { ChartNoAxesColumn } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Scatter,
  ScatterChart,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { EmptyState } from "@/components/empty-state";
import type { JsonObject } from "@/lib/ejson-display";
import {
  type Aggregate,
  type ChartPoint,
  type ChartSpec,
  chartData,
  chartFields,
  defaultSpec,
  type TimeUnit,
} from "../lib/chart";
import { ChartPicker } from "./chart-picker";
import { ResultsMap } from "./results-map";

const AGGREGATES: readonly Aggregate[] = ["sum", "avg", "min", "max"];
const COUNT = "\u0000count";
const BAR_ROW = 28;
const axis = { axisLine: { stroke: "var(--border)" }, tickLine: false, fontSize: 11 } as const;
const timeFormat: Record<TimeUnit, Intl.DateTimeFormatOptions> = {
  hour: { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
  day: { month: "short", day: "numeric" },
  week: { month: "short", day: "numeric" },
  month: { month: "short", year: "numeric" },
  year: { year: "numeric" },
};

interface ResultsChartProps {
  rows: readonly JsonObject[];
  hasMore: boolean;
  onLoadMore: () => void;
}

/** The loaded documents as a chart: counted or aggregated by a field, or one field against another. */
export function ResultsChart({ rows, hasMore, onLoadMore }: ResultsChartProps) {
  const { t, i18n } = useTranslation("results");
  const fields = useMemo(() => chartFields(rows), [rows]);
  // Without the punctuation useId adds, which `url(#…)` does not accept.
  const fadeId = `fade${useId().replace(/[^\w-]/g, "")}`;
  // Marks grow in once, unless the system asks for less motion.
  const [motion] = useState(() =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? { isAnimationActive: false }
      : { isAnimationActive: true, animationDuration: 450, animationEasing: "ease-out" as const },
  );
  const [chosen, setChosen] = useState<ChartSpec | null>(null);
  const fallback = useMemo(() => defaultSpec(fields), [fields]);
  // Fields picked for earlier results may be gone from these ones. Memoized, so a re-render
  // keeps the same chart (and a map keeps where it was zoomed).
  const spec = useMemo(() => {
    if (!chosen || !fields.some((field) => field.path === chosen.x)) return fallback;
    const value = fields.some((field) => field.path === chosen.y && field.role === "number");
    return chosen.y === null || value ? chosen : { ...chosen, y: null };
  }, [chosen, fields, fallback]);
  const role = fields.find((field) => field.path === spec?.x)?.role;
  const data = useMemo(
    () => (spec && role ? chartData(rows, role, spec) : null),
    [rows, role, spec],
  );

  if (!spec || !role || !data) {
    return <EmptyState icon={ChartNoAxesColumn}>{t("chart.noFields")}</EmptyState>;
  }

  const numbers = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 });
  const dates =
    data.kind === "line"
      ? new Intl.DateTimeFormat(i18n.language, { ...timeFormat[data.unit], timeZone: "UTC" })
      : null;
  const formatX = (point: Pick<ChartPoint, "x" | "to" | "other">): string => {
    if (data.kind === "bar") {
      if (point.other) return t("chart.other");
      return point.x === "" ? '""' : String(point.x);
    }
    if (dates) return dates.format(Number(point.x));
    if (point.to !== undefined)
      return `${numbers.format(Number(point.x))}–${numbers.format(point.to)}`;
    return numbers.format(Number(point.x));
  };
  const yLabel =
    spec.y === null
      ? t("chart.count")
      : data.kind === "scatter"
        ? spec.y
        : t("chart.of", { aggregate: t(`chart.aggregate.${spec.aggregate}`), field: spec.y });
  const config = {
    x: { label: spec.x },
    y: { label: yLabel, color: "var(--primary)" },
  } satisfies ChartConfig;
  const points = data.points.map((point) => {
    const label = formatX(point);
    const weekly = data.kind === "line" && data.unit === "week";
    return { ...point, label, tip: weekly ? t("chart.weekOf", { date: label }) : label };
  });
  const tooltip = (
    <ChartTooltip
      cursor={data.kind !== "scatter"}
      content={
        <ChartTooltipContent
          hideLabel={data.kind === "scatter"}
          labelFormatter={(_, payload) => payload[0]?.payload?.tip}
          formatter={(value, name) => (
            <div className="flex w-full items-center justify-between gap-4">
              <span className="text-muted-foreground">
                {config[name as keyof typeof config]?.label}
              </span>
              <span className="font-medium font-mono text-foreground tabular-nums">
                {numbers.format(Number(value))}
              </span>
            </div>
          )}
        />
      }
    />
  );
  const set = (patch: Partial<ChartSpec>) => setChosen({ ...spec, ...patch });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1.5">
        <ChartPicker
          label={t("chart.by")}
          value={spec.x}
          onChange={(x) => set({ x })}
          options={fields.map((field) => ({ value: field.path, label: field.path }))}
        />
        {role !== "geo" && (
          <ChartPicker
            label={t("chart.value")}
            value={spec.y ?? COUNT}
            onChange={(y) => set({ y: y === COUNT ? null : y })}
            options={[
              { value: COUNT, label: t("chart.count") },
              ...fields
                .filter((field) => field.role === "number")
                .map((field) => ({ value: field.path, label: field.path })),
            ]}
          />
        )}
        {spec.y !== null && role !== "number" && role !== "geo" && (
          <ChartPicker
            label={t("chart.aggregate.label")}
            value={spec.aggregate}
            onChange={(aggregate) => set({ aggregate: aggregate as Aggregate })}
            options={AGGREGATES.map((value) => ({
              value,
              label: t(`chart.aggregate.${value}`),
            }))}
          />
        )}
        <span className="ml-auto flex items-center gap-2 text-muted-foreground text-xs">
          <span>
            {t("chart.loaded", { count: rows.length })}
            {data.missing > 0 && ` · ${t("chart.missing", { count: data.missing, field: spec.x })}`}
          </span>
          {hasMore && (
            <Button variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={onLoadMore}>
              {t("chart.loadMore")}
            </Button>
          )}
        </span>
      </div>
      {data.points.length === 0 ? (
        <p className="flex flex-1 items-center justify-center text-muted-foreground text-sm">
          {t("chart.empty", { field: spec.x })}
        </p>
      ) : data.kind === "map" ? (
        <div className="flex min-h-0 flex-1 flex-col px-4 pt-3 pb-4">
          <p className="mb-2 font-medium text-sm">
            {spec.x} <span className="font-normal text-muted-foreground">{t("chart.onMap")}</span>
          </p>
          <div className="min-h-0 flex-1">
            <ResultsMap points={data.points} rows={rows} />
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto px-4 pt-3 pb-4">
          <p className="mb-2 font-medium text-sm">
            {yLabel}{" "}
            <span className="font-normal text-muted-foreground">
              {t(data.kind === "scatter" ? "chart.against" : "chart.byField", { field: spec.x })}
            </span>
          </p>
          <ChartContainer
            // A different kind of chart starts fresh instead of morphing the previous one.
            key={data.kind}
            config={config}
            className="aspect-auto w-full"
            style={{
              height:
                data.kind === "bar"
                  ? Math.max(240, points.length * BAR_ROW + 40)
                  : "calc(100% - 1.75rem)",
            }}
          >
            {data.kind === "bar" ? (
              <BarChart data={points} layout="vertical" margin={{ left: 8, right: 24 }}>
                <CartesianGrid horizontal={false} stroke="var(--border)" />
                <XAxis
                  type="number"
                  {...axis}
                  allowDecimals={spec.y !== null}
                  tickFormatter={(v) => numbers.format(v)}
                />
                <YAxis
                  type="category"
                  dataKey="label"
                  {...axis}
                  width={140}
                  interval={0}
                  tickFormatter={(v: string) => (v.length > 22 ? `${v.slice(0, 21)}…` : v)}
                />
                {tooltip}
                <Bar
                  dataKey="y"
                  fill="var(--color-y)"
                  radius={[0, 4, 4, 0]}
                  barSize={16}
                  {...motion}
                >
                  {points.map((point, index) => (
                    <Cell
                      key={`${index}-${point.label}`}
                      // "Other" is the long tail, not a peer of the bars above it.
                      fillOpacity={point.other ? 0.4 : 1}
                    />
                  ))}
                </Bar>
              </BarChart>
            ) : data.kind === "line" ? (
              <AreaChart data={points} margin={{ left: 8, right: 24, top: 8 }}>
                <defs>
                  <linearGradient id={fadeId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-y)" stopOpacity={0.32} />
                    <stop offset="100%" stopColor="var(--color-y)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="label" {...axis} minTickGap={24} />
                <YAxis
                  {...axis}
                  width={56}
                  allowDecimals={spec.y !== null}
                  tickFormatter={(v) => numbers.format(v)}
                />
                {tooltip}
                <Area
                  dataKey="y"
                  type="linear"
                  fill={`url(#${fadeId})`}
                  stroke="var(--color-y)"
                  strokeWidth={2}
                  dot={
                    points.length <= 40 ? { r: 3, strokeWidth: 0, fill: "var(--color-y)" } : false
                  }
                  activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
                  {...motion}
                />
              </AreaChart>
            ) : data.kind === "histogram" ? (
              <BarChart data={points} margin={{ left: 8, right: 24, top: 8 }} barCategoryGap={2}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="label" {...axis} minTickGap={16} />
                <YAxis {...axis} width={56} allowDecimals={false} />
                {tooltip}
                <Bar dataKey="y" fill="var(--color-y)" radius={[4, 4, 0, 0]} {...motion} />
              </BarChart>
            ) : (
              <ScatterChart margin={{ left: 8, right: 24, top: 8 }}>
                <CartesianGrid stroke="var(--border)" />
                <XAxis
                  type="number"
                  dataKey="x"
                  name="x"
                  {...axis}
                  domain={["auto", "auto"]}
                  tickFormatter={(v) => numbers.format(v)}
                />
                <YAxis
                  type="number"
                  dataKey="y"
                  name="y"
                  {...axis}
                  width={56}
                  domain={["auto", "auto"]}
                  tickFormatter={(v) => numbers.format(v)}
                />
                <ZAxis range={[64, 64]} />
                {tooltip}
                <Scatter data={points} fill="var(--color-y)" fillOpacity={0.7} {...motion} />
              </ScatterChart>
            )}
          </ChartContainer>
        </div>
      )}
    </div>
  );
}
