import type { ConnectionInfo, FieldSummary, Namespace } from "@odin-db/bindings";
import { Badge } from "@odin-db/ui/components/badge";
import { Button } from "@odin-db/ui/components/button";
import { cn } from "@odin-db/ui/lib/utils";
import { CircleAlert, Loader2, RotateCw } from "lucide-react";
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
}: {
  connection: ConnectionInfo;
  namespace: Namespace;
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
                <FieldRow key={field.path} field={field} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function FieldRow({ field }: { field: FieldSummary }) {
  const { t } = useTranslation("schema");
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
        <div className="flex flex-wrap gap-1">
          {field.types.map((type) => (
            <Badge key={type} variant="secondary" className="font-mono text-[11px]">
              {type}
            </Badge>
          ))}
          {field.types.length > 1 && (
            <span className="text-warning text-xs" title={t("mixedHint")}>
              {t("mixed")}
            </span>
          )}
        </div>
      </td>
      <td className="max-w-md px-3 py-1.5">
        <div className="flex flex-wrap gap-1">
          {field.values.slice(0, MAX_VALUES).map((value) => (
            <span
              key={value}
              className="truncate rounded-sm bg-muted px-1.5 font-mono text-[11px] text-type-string"
            >
              {JSON.stringify(value)}
            </span>
          ))}
          {field.values.length > MAX_VALUES && (
            <span className="text-muted-foreground text-xs">
              {t("more", { count: field.values.length - MAX_VALUES })}
            </span>
          )}
        </div>
      </td>
    </tr>
  );
}
