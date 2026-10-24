import { Button } from "@odin-db/ui/components/button";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@odin-db/ui/components/chart";
import { ChartNoAxesColumn } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Scatter,
  ScatterChart,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
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

const AGGREGATES: readonly Aggregate[] = ["sum", "avg", "min", "max"];
const COUNT = "\u0000count";
const BAR_ROW = 28;
const axis = { axisLine: { stroke: "var(--border)" }, tickLine: false, fontSize: 11 } as const;
const timeFormat: Record<TimeUnit, Intl.DateTimeFormatOptions> = {
  hour: { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
  day: { month: "short", day: "numeric" },
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
  const [chosen, setChosen] = useState<ChartSpec | null>(null);
  // A field picked for earlier results may be gone from these ones.
  const spec =
    chosen && fields.some((field) => field.path === chosen.x) ? chosen : defaultSpec(fields);
  const role = fields.find((field) => field.path === spec?.x)?.role;
  const data = useMemo(
    () => (spec && role ? chartData(rows, role, spec) : null),
    [rows, role, spec],
  );

  if (!spec || !role || !data) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
        <ChartNoAxesColumn className="size-5" />
        <p className="max-w-sm text-sm">{t("chart.noFields")}</p>
      </div>
    );
  }

  const numbers = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 });
  const dates =
    data.kind === "line"
      ? new Intl.DateTimeFormat(i18n.language, { ...timeFormat[data.unit], timeZone: "UTC" })
      : null;
  const formatX = (point: Pick<ChartPoint, "x" | "to">): string => {
    if (data.kind === "bar") return point.x === "" ? t("chart.other") : String(point.x);
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
  const points = data.points.map((point) => ({ ...point, label: formatX(point) }));
  const tooltip = (
    <ChartTooltip
      cursor={data.kind !== "scatter"}
      content={
        <ChartTooltipContent
          hideLabel={data.kind === "scatter"}
          labelFormatter={(_, payload) => payload[0]?.payload?.label}
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
        {spec.y !== null && role !== "number" && (
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
                  isAnimationActive={false}
                >
                  {points.map((point) => (
                    <Cell
                      key={point.label}
                      // "Other" is the long tail, not a peer of the bars above it.
                      fillOpacity={data.other && point.x === "" ? 0.4 : 1}
                    />
                  ))}
                </Bar>
              </BarChart>
            ) : data.kind === "line" ? (
              <LineChart data={points} margin={{ left: 8, right: 24, top: 8 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="label" {...axis} minTickGap={24} />
                <YAxis
                  {...axis}
                  width={56}
                  allowDecimals={spec.y !== null}
                  tickFormatter={(v) => numbers.format(v)}
                />
                {tooltip}
                <Line
                  dataKey="y"
                  type="linear"
                  stroke="var(--color-y)"
                  strokeWidth={2}
                  dot={
                    points.length <= 40 ? { r: 3, strokeWidth: 0, fill: "var(--color-y)" } : false
                  }
                  activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
                  isAnimationActive={false}
                />
              </LineChart>
            ) : data.kind === "histogram" ? (
              <BarChart data={points} margin={{ left: 8, right: 24, top: 8 }} barCategoryGap={2}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="label" {...axis} minTickGap={16} />
                <YAxis {...axis} width={56} allowDecimals={false} />
                {tooltip}
                <Bar
                  dataKey="y"
                  fill="var(--color-y)"
                  radius={[4, 4, 0, 0]}
                  isAnimationActive={false}
                />
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
                <Scatter
                  data={points}
                  fill="var(--color-y)"
                  fillOpacity={0.7}
                  isAnimationActive={false}
                />
              </ScatterChart>
            )}
          </ChartContainer>
        </div>
      )}
    </div>
  );
}
