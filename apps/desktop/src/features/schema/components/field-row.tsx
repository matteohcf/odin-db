import type { FieldSummary, JsonValue } from "@odin-db/bindings";
import { Badge } from "@odin-db/ui/components/badge";
import { TableCell, TableRow } from "@odin-db/ui/components/table";
import { cn } from "@odin-db/ui/lib/utils";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { describeEJson, isJsonObject } from "@/lib/ejson-display";

const MAX_VALUES = 6;

/** One field of the sampled schema: how often it appears, its types, range and common values. */
export function FieldRow({
  field,
  onFilterBy,
}: {
  field: FieldSummary;
  onFilterBy: ((field: string, literal: string) => void) | undefined;
}) {
  const { t, i18n } = useTranslation("schema");
  const [allValues, setAllValues] = useState(false);
  const values = allValues ? field.values : field.values.slice(0, MAX_VALUES);
  const parts = field.path.split(".");
  const depth = parts.length - 1;
  const frequency = field.frequency ?? 0;
  const percent = Math.round(frequency * 100);

  return (
    <TableRow className="border-b border-border/60 hover:bg-accent/40">
      <TableCell className="px-3 py-1.5 font-mono text-xs" title={field.path}>
        <span
          style={{ paddingLeft: depth * 16 }}
          className={cn(depth > 0 && "text-muted-foreground")}
        >
          {depth > 0 && <span className="text-muted-foreground/50">└ </span>}
          <span className="text-foreground">{parts.at(-1)}</span>
        </span>
      </TableCell>
      <TableCell className="py-1.5">
        <div className="flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className={cn("h-full rounded-full", percent === 100 ? "bg-success" : "bg-primary")}
              style={{ width: `${percent}%` }}
            />
          </div>
          <span className="w-10 text-right text-muted-foreground text-xs tabular-nums">
            {percent}%
          </span>
        </div>
      </TableCell>
      <TableCell className="py-1.5">
        <div className="flex flex-wrap items-center gap-1">
          {field.types.map((type, index) => {
            const share = field.typeShares[index];
            return (
              <Badge key={type} variant="secondary" className="gap-1 font-mono text-[11px]">
                {type}
                {/* With several types, how the documents split between them. */}
                {field.types.length > 1 && share != null && (
                  <span className="font-sans text-muted-foreground tabular-nums">
                    {Math.max(1, Math.round(share * 100))}%
                  </span>
                )}
              </Badge>
            );
          })}
          {field.types.length > 1 && (
            <span className="text-warning text-xs" title={t("mixedHint")}>
              {t("mixed")}
            </span>
          )}
        </div>
      </TableCell>
      <TableCell className="max-w-md py-1.5">
        <div className="flex flex-wrap gap-1">
          {field.range && (
            <span
              className="font-mono text-[11px] text-muted-foreground tabular-nums selectable"
              title={t("rangeHint")}
            >
              {t("range", {
                min: rangeEnd(field.range.min, i18n.language),
                max: rangeEnd(field.range.max, i18n.language),
              })}
            </span>
          )}
          {values.map((value) =>
            onFilterBy ? (
              <button
                key={value}
                type="button"
                title={t("filterBy", { field: field.path, value })}
                onClick={() => onFilterBy(field.path, JSON.stringify(value))}
                className="truncate rounded-sm bg-muted px-1.5 font-mono text-[11px] text-type-string outline-none hover:bg-accent hover:ring-1 hover:ring-border focus-visible:ring-2 focus-visible:ring-ring"
              >
                {JSON.stringify(value)}
              </button>
            ) : (
              <span
                key={value}
                className="truncate rounded-sm bg-muted px-1.5 font-mono text-[11px] text-type-string"
              >
                {JSON.stringify(value)}
              </span>
            ),
          )}
          {field.values.length > MAX_VALUES && !allValues && (
            <button
              type="button"
              onClick={() => setAllValues(true)}
              className="text-muted-foreground text-xs hover:text-foreground"
            >
              {t("more", { count: field.values.length - MAX_VALUES })}
            </button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

/** A range end as people read it: a plain number, or a date (UTC) without the wrapper. */
function rangeEnd(value: JsonValue, locale: string): string {
  if (isJsonObject(value)) {
    const [key, inner] = Object.entries(value)[0] ?? [];
    if (key === "$date") {
      const millis = isJsonObject(inner) ? Number(inner.$numberLong) : Date.parse(String(inner));
      if (!Number.isNaN(millis))
        return new Date(millis).toISOString().slice(0, 16).replace("T", " ");
    } else if (key?.startsWith("$number")) {
      const number = Number(inner);
      if (Number.isFinite(number))
        return number.toLocaleString(locale, { maximumFractionDigits: 4 });
    }
  }
  return describeEJson(value).text;
}
