import type { ConnectionInfo, EJsonDocument, FieldSummary, Namespace } from "@odin-db/bindings";
import { Button } from "@odin-db/ui/components/button";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@odin-db/ui/components/table";
import { cn } from "@odin-db/ui/lib/utils";
import { CircleAlert, FileSearch, Loader2, RotateCw } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/empty-state";
import { InlineError } from "@/components/inline-error";
import { QueryEditor } from "@/components/query-editor";
import { QueryFieldFrame } from "@/components/query-field-frame";
import { useQueryCompletions } from "@/hooks/use-query-completions";
import { errorMessage } from "@/lib/ipc";
import { parseShellDocument } from "@/lib/shell-syntax";
import { SCHEMA_SAMPLE, useSchema } from "../api/use-schema";
import { FieldRow } from "./field-row";

const NO_FIELDS: FieldSummary[] = [];

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
  const [text, setText] = useState("");
  const [filter, setFilter] = useState<EJsonDocument | null>(null);
  const [invalid, setInvalid] = useState<string | null>(null);
  // The unfiltered analysis suggests the fields while typing a filter.
  const all = useSchema(connection.id, namespace, null);
  const schema = useSchema(connection.id, namespace, filter);
  const completionsFor = useQueryCompletions(all.data ?? NO_FIELDS);
  const fields = [...(schema.data ?? [])].sort(byPath);

  async function apply() {
    const body = text.trim();
    try {
      // Braces are optional, as in the query bar.
      const next =
        body === "" ? null : await parseShellDocument(body.startsWith("{") ? body : `{ ${body} }`);
      setInvalid(null);
      if (JSON.stringify(next) === JSON.stringify(filter)) void schema.refetch();
      else setFilter(next);
    } catch (error) {
      setInvalid(errorMessage(error));
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-col gap-2 border-b px-3 py-2.5">
        <div className="flex items-center gap-3">
          <QueryFieldFrame label={t("filter")} invalid={invalid !== null} className="flex-1">
            <QueryEditor
              value={text}
              onChange={setText}
              onSubmit={() => void apply()}
              completions={completionsFor("filter")}
              placeholder={t("filterPlaceholder")}
              ariaLabel={t("filter")}
              invalid={invalid !== null}
              className="min-w-0 flex-1"
            />
          </QueryFieldFrame>
          <Button size="sm" disabled={schema.isFetching} onClick={() => void apply()}>
            <RotateCw className={cn(schema.isFetching && "animate-spin")} />
            {t("analyze")}
          </Button>
        </div>
        {invalid && <InlineError>{invalid}</InlineError>}
        <p className="text-muted-foreground text-xs">
          {filter
            ? t("sampleMatching", { count: SCHEMA_SAMPLE })
            : t("sample", { count: SCHEMA_SAMPLE })}
        </p>
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
          <EmptyState icon={FileSearch}>{t("empty")}</EmptyState>
        ) : (
          <Table className="text-sm">
            <TableHeader className="sticky top-0 bg-sidebar text-xs">
              <TableRow className="border-b">
                <TableHead>{t("columns.field")}</TableHead>
                <TableHead className="w-56">{t("columns.presence")}</TableHead>
                <TableHead>{t("columns.types")}</TableHead>
                <TableHead>{t("columns.values")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fields.map((field) => (
                <FieldRow key={field.path} field={field} onFilterBy={onFilterBy} />
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
