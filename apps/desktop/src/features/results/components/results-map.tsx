import { Maximize, Minus, Plus } from "lucide-react";
import { type PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { IconAction } from "@/components/icon-action";
import { compactEJson, type JsonObject } from "@/lib/ejson-display";
import type { ChartPoint } from "../lib/chart";
import { fitBox, type MapBox, panBox, project, zoomBox } from "../lib/map-view";
import { WORLD_LAND } from "../lib/world-land";

const NAME_FIELDS = ["name", "title", "label", "email"];
/** Narrower than this (degrees of longitude), the coarse outline shows its corners. */
const DETAIL_BELOW = 60;

/** What a point's tooltip calls its document: a name-like field, else its `_id`. */
function nameOf(row: JsonObject | undefined): string {
  if (!row) return "";
  for (const key of NAME_FIELDS) {
    const value = row[key];
    if (typeof value === "string" && value !== "") return value;
  }
  return row._id === undefined ? "" : compactEJson(row._id).text;
}

interface ResultsMapProps {
  points: readonly ChartPoint[];
  rows: readonly JsonObject[];
}

/**
 * Documents as dots on a world map, drawn from a bundled outline: no tile server, so looking
 * at the data sends nothing anywhere. Wheel to zoom, drag to pan.
 */
export function ResultsMap({ points, rows }: ResultsMapProps) {
  const { t, i18n } = useTranslation("results");
  const frame = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [moved, setMoved] = useState<MapBox | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [detailed, setDetailed] = useState<string | null>(null);

  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const aspect = size.width > 0 && size.height > 0 ? size.width / size.height : 2;
  const fitted = useMemo(
    () =>
      fitBox(
        points.map((point): [number, number] => [Number(point.x), point.y ?? 0]),
        aspect,
      ),
    [points, aspect],
  );
  // New results frame their own points again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only new points reset the view.
  useEffect(() => setMoved(null), [points]);
  const box = moved ?? fitted;
  const zoomedIn = box.width < DETAIL_BELOW;
  // Ten times the outline, fetched the first time someone zooms into a region.
  useEffect(() => {
    if (!zoomedIn || detailed) return;
    void import("../lib/world-land-detailed").then((module) =>
      setDetailed(module.WORLD_LAND_DETAILED),
    );
  }, [zoomedIn, detailed]);
  // Map units per screen pixel: keeps dots and strokes the same size at any zoom.
  const unit = size.width > 0 ? box.width / size.width : 0.1;
  const toMap = (clientX: number, clientY: number): [number, number] => {
    const rect = frame.current?.getBoundingClientRect();
    if (!rect) return [box.x + box.width / 2, box.y + box.height / 2];
    return [box.x + (clientX - rect.left) * unit, box.y + (clientY - rect.top) * unit];
  };
  const center: [number, number] = [box.x + box.width / 2, box.y + box.height / 2];

  // React's wheel listener is passive; zooming needs to stop the page from scrolling.
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      setMoved((current) => {
        const from = current ?? fitted;
        const perPixel = from.width / rect.width;
        const focus: [number, number] = [
          from.x + (event.clientX - rect.left) * perPixel,
          from.y + (event.clientY - rect.top) * perPixel,
        ];
        return zoomBox(from, Math.exp(-event.deltaY * 0.002), focus);
      });
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [fitted]);

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    drag.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const start = drag.current;
    if (!start) return;
    drag.current = { x: event.clientX, y: event.clientY };
    setMoved(panBox(box, (start.x - event.clientX) * unit, (start.y - event.clientY) * unit));
  }

  const coordinates = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 4 });
  const shown = hovered === null ? undefined : points[hovered];
  const tip = shown ? project(Number(shown.x), shown.y ?? 0) : null;

  return (
    <div className="relative size-full overflow-hidden rounded-md border bg-[color-mix(in_oklab,var(--primary)_7%,var(--card))]">
      <div
        ref={frame}
        role="img"
        aria-label={t("chart.map", { count: points.length })}
        className="absolute inset-0 cursor-grab touch-none active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => {
          drag.current = null;
        }}
        onDoubleClick={(event) => setMoved(zoomBox(box, 2, toMap(event.clientX, event.clientY)))}
      >
        <svg
          viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`}
          className="absolute inset-0 size-full"
          aria-hidden="true"
        >
          <path
            d={zoomedIn && detailed ? detailed : WORLD_LAND}
            fill="color-mix(in oklab, var(--foreground) 8%, var(--card))"
            stroke="var(--border)"
            strokeWidth={unit}
            strokeLinejoin="round"
          />
          {points.map((point, index) => {
            const [x, y] = project(Number(point.x), point.y ?? 0);
            return (
              <circle
                key={point.row ?? index}
                data-point
                cx={x}
                cy={y}
                r={(index === hovered ? 5.5 : 4) * unit}
                fill="var(--primary)"
                stroke="var(--card)"
                strokeWidth={1.5 * unit}
                onPointerEnter={() => setHovered(index)}
                onPointerLeave={() => setHovered(null)}
              />
            );
          })}
        </svg>
        {shown && tip && (
          <div
            className="pointer-events-none absolute z-10 grid min-w-32 gap-0.5 rounded-lg border bg-background px-2.5 py-1.5 text-xs shadow-xl"
            style={{
              left: (tip[0] - box.x) / unit + 10,
              top: (tip[1] - box.y) / unit + 10,
            }}
          >
            <span className="max-w-64 truncate font-medium">
              {nameOf(shown.row === undefined ? undefined : rows[shown.row])}
            </span>
            <span className="font-mono text-muted-foreground tabular-nums">
              {coordinates.format(shown.y ?? 0)}, {coordinates.format(Number(shown.x))}
            </span>
          </div>
        )}
      </div>
      <div className="absolute top-2 right-2 flex flex-col gap-0.5 rounded-md border bg-card p-0.5 shadow-xs">
        <IconAction label={t("chart.zoomIn")} onClick={() => setMoved(zoomBox(box, 2, center))}>
          <Plus />
        </IconAction>
        <IconAction label={t("chart.zoomOut")} onClick={() => setMoved(zoomBox(box, 0.5, center))}>
          <Minus />
        </IconAction>
        <IconAction label={t("chart.fit")} onClick={() => setMoved(null)}>
          <Maximize />
        </IconAction>
      </div>
    </div>
  );
}
