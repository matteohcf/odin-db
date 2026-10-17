import { Button } from "@odin-db/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@odin-db/ui/components/dialog";
import { CircleAlert, Copy, Info } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import type { QueryForm } from "../lib/query-form";
import { type SqlTranslation, translateSql } from "../lib/sql";

interface SqlDialogProps {
  collection: string;
  onUse: (form: QueryForm) => void;
  onClose: () => void;
}

const EXAMPLE =
  "SELECT * FROM {{collection}}\nWHERE age >= 30 AND plan IN ('pro', 'team')\nORDER BY age DESC\nLIMIT 50";

/** Translates a SQL SELECT into a query for this collection. */
export function SqlDialog({ collection, onUse, onClose }: SqlDialogProps) {
  const { t } = useTranslation("documents");
  const id = useId();
  const [sql, setSql] = useState(() => EXAMPLE.replace("{{collection}}", collection));
  const settled = useDebouncedValue(sql, 200);
  const result = useMemo((): { ok: true; value: SqlTranslation } | { ok: false; error: string } => {
    try {
      return { ok: true, value: translateSql(settled) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }, [settled]);
  const other =
    result.ok && result.value.collection !== collection ? result.value.collection : null;

  function use() {
    if (!result.ok || result.value.kind !== "find") return;
    const { filter, sort, projection, skip, limit } = result.value;
    onUse({ filter, sort, projection, skip, limit });
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[calc(100vh-3rem)] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("sql.title")}</DialogTitle>
          <DialogDescription>{t("sql.description")}</DialogDescription>
        </DialogHeader>
        <label htmlFor={`${id}-sql`} className="sr-only">
          {t("sql.input")}
        </label>
        <textarea
          id={`${id}-sql`}
          value={sql}
          onChange={(event) => setSql(event.target.value)}
          rows={6}
          spellCheck={false}
          className="w-full resize-y rounded-md border bg-background px-3 py-2 font-mono text-[length:var(--editor-font-size,12.5px)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
          autoFocus
        />
        {result.ok ? (
          <section
            aria-label={t("sql.result")}
            className="flex min-h-0 flex-col gap-2 overflow-y-auto"
          >
            {other && (
              <p className="flex items-start gap-1.5 text-muted-foreground text-xs">
                <Info className="mt-px size-3.5 shrink-0" />
                {t("sql.otherCollection", { other, collection })}
              </p>
            )}
            {result.value.kind === "find" ? (
              <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1.5 rounded-md border bg-muted/40 p-3 text-xs">
                {(["filter", "projection", "sort", "skip", "limit"] as const).map((key) =>
                  result.value.kind === "find" && result.value[key] ? (
                    <div key={key} className="contents">
                      <dt className="text-muted-foreground">{t(`query.${key}`)}</dt>
                      <dd className="font-mono selectable">{result.value[key]}</dd>
                    </div>
                  ) : null,
                )}
              </dl>
            ) : (
              <>
                <p className="text-muted-foreground text-xs">{t("sql.aggregate")}</p>
                <pre className="rounded-md border bg-muted/40 p-3 font-mono text-xs selectable">
                  {result.value.pipeline}
                </pre>
              </>
            )}
          </section>
        ) : (
          <p role="alert" className="flex items-start gap-1.5 text-destructive text-xs selectable">
            <CircleAlert className="mt-px size-3.5 shrink-0" />
            {result.error}
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("actions.cancel", { ns: "common" })}
          </Button>
          {result.ok && result.value.kind === "aggregate" ? (
            <Button
              onClick={() => {
                if (result.value.kind !== "aggregate") return;
                void navigator.clipboard.writeText(result.value.pipeline);
                toast.success(t("sql.copied"));
              }}
            >
              <Copy />
              {t("sql.copyPipeline")}
            </Button>
          ) : (
            <Button onClick={use} disabled={!result.ok}>
              {t("sql.use")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
