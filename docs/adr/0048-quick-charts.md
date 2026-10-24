# 0048. Quick charts of results

- Status: Accepted
- Date: 2026-10-24

## Context

A query or pipeline answers "how many per status" or "how much per month" as rows; reading the
shape of the answer means exporting it to a spreadsheet. Compass charts live in a separate
product (Atlas Charts); Studio 3T has none built in.

## Decision

- Results get a fourth view, **Chart**, next to table, tree and JSON, for documents and pipelines
  alike. It charts the documents already loaded (ADR-0025), says how many, and offers to load
  more. Nothing extra is queried.
- One control row: **By** (a field), **Value** (count of documents or a numeric field) and, for a
  numeric value, an **aggregate** (sum, average, minimum, maximum). The chart type follows the
  field instead of being another choice:
  - a date gives a line over UTC hours, days, months or years (picked from the span), with empty
    buckets shown as zero when counting;
  - text or booleans give horizontal bars, largest first, the tail past 20 folded into "Other";
  - a number gives a histogram when counting, a scatter plot against a numeric value.
- `features/results/lib/chart.ts` turns canonical EJSON rows into chart data without React and
  is unit tested; documents without the field are counted and reported, not plotted.
- Drawn with the shadcn `chart` component over **Recharts** (MIT), loaded lazily with the view.
  One series, in the accent color; the title names the measure, so there is no legend.

## Alternatives considered

- **Server-side `$group` per chart** — exact over the whole collection, but runs a query per
  control change; the aggregation tab already does that on purpose, and its results chart too.
- **A hand-written SVG chart** — no dependency, but axes, ticks, tooltips and resizing are a lot to
  own; shadcn's chart is the project's UI kit.

## Consequences

- A chart reflects the loaded documents only, which the view states.
- One new dependency (Recharts, in its own chunk).
