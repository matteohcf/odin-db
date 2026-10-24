import type { CollectionComparison, IndexInfo } from "@odin-db/bindings";
import { Badge } from "@odin-db/ui/components/badge";
import { Button } from "@odin-db/ui/components/button";
import { cn } from "@odin-db/ui/lib/utils";
import { ChevronRight, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toShellSyntax } from "@/lib/shell-syntax";
import { indexOptions } from "../lib/index-request";

interface SchemaDifferenceRowProps {
  comparison: CollectionComparison;
  leftLabel: string;
  rightLabel: string;
  /** Creates an index found on one side on the other one; `undefined` where it is read-only. */
  onCreateLeft?: ((collection: string, index: IndexInfo) => void) | undefined;
  onCreateRight?: ((collection: string, index: IndexInfo) => void) | undefined;
}

/** One collection of a schema comparison: what differs, opened on demand. */
export function SchemaDifferenceRow({
  comparison,
  leftLabel,
  rightLabel,
  onCreateLeft,
  onCreateRight,
}: SchemaDifferenceRowProps) {
  const { t } = useTranslation("compare");
  const [open, setOpen] = useState(false);
  const { name, presence, fields, indexes, validation, error } = comparison;
  const expandable = fields.length > 0 || indexes.length > 0 || validation !== null;
  const types = (list: string[], frequency: number | null) =>
    list.length === 0 ? (
      <span className="text-muted-foreground">—</span>
    ) : (
      <span>
        {list.join(", ")}
        {(frequency ?? 1) < 1 && (
          <span className="text-muted-foreground"> · {Math.round((frequency ?? 0) * 100)}%</span>
        )}
      </span>
    );
  const side = (index: IndexInfo | null) =>
    index ? (
      <span className="flex flex-wrap items-center gap-1">
        <span className="font-mono">{index.name}</span>
        {indexOptions(index).map((option) => (
          <Badge key={option} variant="secondary" className="text-[10px]">
            {option}
          </Badge>
        ))}
      </span>
    ) : (
      <span className="text-muted-foreground">—</span>
    );

  return (
    <li>
      <button
        type="button"
        disabled={!expandable}
        aria-expanded={expandable ? open : undefined}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm enabled:hover:bg-accent"
      >
        <ChevronRight
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90",
            !expandable && "invisible",
          )}
        />
        <span className="truncate font-medium">{name}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {presence === "leftOnly" && (
            <Badge variant="outline">{t("schema.onlyIn", { side: leftLabel })}</Badge>
          )}
          {presence === "rightOnly" && (
            <Badge variant="outline">{t("schema.onlyIn", { side: rightLabel })}</Badge>
          )}
          {fields.length > 0 && (
            <Badge variant="secondary">{t("schema.fields", { count: fields.length })}</Badge>
          )}
          {indexes.length > 0 && (
            <Badge variant="secondary">{t("schema.indexes", { count: indexes.length })}</Badge>
          )}
          {validation && <Badge variant="secondary">{t("schema.rules")}</Badge>}
          {error && (
            <Badge variant="outline" className="text-destructive" title={error}>
              {t("schema.unreadable")}
            </Badge>
          )}
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-3 border-t bg-muted/30 px-3 py-3 text-xs">
          {fields.length > 0 && (
            <table className="w-full">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="pb-1 font-medium">{t("schema.field")}</th>
                  <th className="pb-1 font-medium">{leftLabel}</th>
                  <th className="pb-1 font-medium">{rightLabel}</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {fields.map((field) => (
                  <tr key={field.path}>
                    <td className="py-0.5 pr-3">{field.path}</td>
                    <td className="py-0.5 pr-3">{types(field.leftTypes, field.leftFrequency)}</td>
                    <td className="py-0.5">{types(field.rightTypes, field.rightFrequency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {indexes.length > 0 && (
            <table className="w-full">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="pb-1 font-medium">{t("schema.keys")}</th>
                  <th className="pb-1 font-medium">{leftLabel}</th>
                  <th className="pb-1 font-medium">{rightLabel}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {indexes.map((difference) => {
                  const index = difference.left ?? difference.right;
                  if (!index) return null;
                  const create =
                    difference.left && !difference.right
                      ? onCreateRight && (() => onCreateRight(name, difference.left as IndexInfo))
                      : difference.right && !difference.left
                        ? onCreateLeft && (() => onCreateLeft(name, difference.right as IndexInfo))
                        : undefined;
                  return (
                    <tr key={toShellSyntax(index.keys, 0)}>
                      <td className="py-1 pr-3 font-mono">{toShellSyntax(index.keys, 0)}</td>
                      <td className="py-1 pr-3">{side(difference.left)}</td>
                      <td className="py-1 pr-3">{side(difference.right)}</td>
                      <td className="py-1 text-right">
                        {create && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-xs"
                            onClick={create}
                          >
                            <Plus />
                            {t("schema.createHere", {
                              side: difference.left ? rightLabel : leftLabel,
                            })}
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {validation && (
            <div className="grid grid-cols-2 gap-2">
              {[validation.left, validation.right].map((rules, position) => (
                <div key={position === 0 ? "left" : "right"} className="flex flex-col gap-1">
                  <span className="text-muted-foreground">
                    {position === 0 ? leftLabel : rightLabel} · {rules.level} · {rules.action}
                  </span>
                  <pre className="max-h-40 overflow-auto rounded-md border bg-background p-2 font-mono text-[11px] selectable">
                    {toShellSyntax(rules.validator)}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </li>
  );
}
