import type { ConnectionInfo, FieldSummary, Namespace } from "@odin-db/bindings";
import { Badge } from "@odin-db/ui/components/badge";
import { Button } from "@odin-db/ui/components/button";
import { cn } from "@odin-db/ui/lib/utils";
import { CircleAlert, Loader2, RotateCw } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { errorMessage } from "@/lib/ipc";
import { SCHEMA_SAMPLE, useSchema } from "../api/use-schema";

const MAX_VALUES = 6;

/** Parents before their children, so nested fields read as a tree. */
function byPath(a: FieldSummary, b: FieldSummary) {
  const left = a.path.split(".");
  const right = b.path.split(".");
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const order = (left[i] ?? "").localeCompare(right[i] ?? "");
    if (order !== 0) return a.path === "_id" ? -1 : b.path === "_id" ? 1 : order;
  }
  return left.length - right.length;
}

/** Field paths of a random sample: how often each appears, its types and values. */
export function SchemaView({
  connection,
  namespace,
  onFilterBy,
}: {
  connection: ConnectionInfo;
  namespace: Namespace;
  /** Shows the documents where the field has this value (mongosh literal). */
  onFilterBy?: ((field: string, literal: string) => void) | undefined;
}) {
  const { t } = useTranslation("schema");
  const schema = useSchema(connection.id, namespace);
  const fields = [...(schema.data ?? [])].sort(byPath);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b px-3 py-2.5 text-muted-foreground text-xs">
        <span>{t("sample", { count: SCHEMA_SAMPLE })}</span>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          disabled={schema.isFetching}
          onClick={() => void schema.refetch()}
        >
          <RotateCw className={cn(schema.isFetching && "animate-spin")} />
          {t("resample")}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {schema.isPending ? (
          <p className="flex items-center justify-center gap-2 p-10 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t("analyzing")}
          </p>
        ) : schema.error ? (
          <p className="flex items-center gap-2 p-6 text-destructive text-xs selectable">
            <CircleAlert className="size-4" />
            {t("failed", { message: errorMessage(schema.error) })}
          </p>
        ) : fields.length === 0 ? (
          <p className="p-10 text-center text-muted-foreground">{t("empty")}</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-sidebar text-left text-muted-foreground text-xs">
              <tr className="border-b">
                <th className="px-3 py-2 font-medium">{t("columns.field")}</th>
                <th className="w-56 px-3 py-2 font-medium">{t("columns.presence")}</th>
                <th className="px-3 py-2 font-medium">{t("columns.types")}</th>
                <th className="px-3 py-2 font-medium">{t("columns.values")}</th>
              </tr>
            </thead>
            <tbody>
              {fields.map((field) => (
                <FieldRow key={field.path} field={field} onFilterBy={onFilterBy} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function FieldRow({
  field,
  onFilterBy,
}: {
  field: FieldSummary;
  onFilterBy: ((field: string, literal: string) => void) | undefined;
}) {
  const { t } = useTranslation("schema");
  const [allValues, setAllValues] = useState(false);
  const values = allValues ? field.values : field.values.slice(0, MAX_VALUES);
  const parts = field.path.split(".");
  const depth = parts.length - 1;
  const frequency = field.frequency ?? 0;
  const percent = Math.round(frequency * 100);

  return (
    <tr className="border-b border-border/60 hover:bg-accent/40">
      <td className="px-3 py-1.5 font-mono text-xs" title={field.path}>
        <span
          style={{ paddingLeft: depth * 16 }}
          className={cn(depth > 0 && "text-muted-foreground")}
        >
          {depth > 0 && <span className="text-muted-foreground/50">└ </span>}
          <span className="text-foreground">{parts.at(-1)}</span>
        </span>
      </td>
      <td className="px-3 py-1.5">
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
      </td>
      <td className="px-3 py-1.5">
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
      </td>
      <td className="max-w-md px-3 py-1.5">
        <div className="flex flex-wrap gap-1">
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
      </td>
    </tr>
  );
}
