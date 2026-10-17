import type { FieldSummary } from "@odin-db/bindings";
import { Button } from "@odin-db/ui/components/button";
import { Input } from "@odin-db/ui/components/input";
import { Popover, PopoverContent, PopoverTrigger } from "@odin-db/ui/components/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@odin-db/ui/components/select";
import { ToggleGroup, ToggleGroupItem } from "@odin-db/ui/components/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@odin-db/ui/components/tooltip";
import { ListFilterPlus, Plus, X } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  buildFilter,
  type Combinator,
  type Condition,
  OPERATORS,
  type Operator,
  takesValue,
} from "../lib/visual-query";

interface VisualQueryBuilderProps {
  fields: readonly FieldSummary[];
  /** Puts the built filter in the query bar; `run` also runs it. */
  onApply: (filter: string, run: boolean) => void;
}

const emptyRow = (): Condition => ({ field: "", operator: "eq", value: "" });

/** Builds a filter from rows of field, operator and value, for those who'd rather not type it. */
export function VisualQueryBuilder({ fields, onApply }: VisualQueryBuilderProps) {
  const { t } = useTranslation("documents");
  const id = useId();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Condition[]>([emptyRow()]);
  const [combinator, setCombinator] = useState<Combinator>("and");
  const typesOf = (field: string) => fields.find((f) => f.path === field)?.types ?? [];
  const filter = buildFilter(rows, combinator, typesOf);
  const update = (index: number, patch: Partial<Condition>) =>
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const apply = (run: boolean) => {
    onApply(filter, run);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("builder.open")}
              className="text-muted-foreground"
            >
              <ListFilterPlus />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{t("builder.open")}</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="flex w-[40rem] flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-medium text-sm">{t("builder.title")}</h2>
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            value={combinator}
            onValueChange={(value) => value && setCombinator(value as Combinator)}
            aria-label={t("builder.combinator")}
          >
            <ToggleGroupItem value="and" className="px-3 text-xs">
              {t("builder.all")}
            </ToggleGroupItem>
            <ToggleGroupItem value="or" className="px-3 text-xs">
              {t("builder.any")}
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        <datalist id={`${id}-fields`}>
          {fields.map((field) => (
            <option key={field.path} value={field.path} />
          ))}
        </datalist>
        <div className="flex flex-col gap-2">
          {rows.map((row, index) => {
            const known = fields.find((f) => f.path === row.field);
            return (
              // Rows are positional; editing one never reorders the others.
              <div key={index} className="flex items-center gap-2">
                <Input
                  aria-label={t("builder.field", { number: index + 1 })}
                  list={`${id}-fields`}
                  value={row.field}
                  onChange={(event) => update(index, { field: event.target.value })}
                  placeholder={t("builder.fieldPlaceholder")}
                  className="h-8 w-44 font-mono text-xs"
                  spellCheck={false}
                  autoFocus={index === 0}
                />
                <Select
                  value={row.operator}
                  onValueChange={(operator) => update(index, { operator: operator as Operator })}
                >
                  <SelectTrigger
                    size="sm"
                    className="h-8 w-40 text-xs"
                    aria-label={t("builder.operator", { number: index + 1 })}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {OPERATORS.map((operator) => (
                      <SelectItem key={operator} value={operator} className="text-xs">
                        {t(`builder.operators.${operator}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {takesValue(row.operator) ? (
                  <Input
                    aria-label={t("builder.value", { number: index + 1 })}
                    value={row.value}
                    onChange={(event) => update(index, { value: event.target.value })}
                    list={known?.values.length ? `${id}-values-${index}` : undefined}
                    placeholder={
                      row.operator === "in" || row.operator === "nin"
                        ? t("builder.listPlaceholder")
                        : (known?.types.join(" | ") ?? "")
                    }
                    className="h-8 flex-1 font-mono text-xs"
                    spellCheck={false}
                  />
                ) : (
                  <span className="flex-1" />
                )}
                {known?.values.length ? (
                  <datalist id={`${id}-values-${index}`}>
                    {known.values.map((value) => (
                      <option key={value} value={value} />
                    ))}
                  </datalist>
                ) : null}
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label={t("builder.remove", { number: index + 1 })}
                  disabled={rows.length === 1}
                  onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
                >
                  <X />
                </Button>
              </div>
            );
          })}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => setRows((current) => [...current, emptyRow()])}
        >
          <Plus />
          {t("builder.add")}
        </Button>
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-xs">{t("builder.preview")}</span>
          <code
            data-testid="builder-preview"
            className="min-h-8 rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs selectable"
          >
            {filter || t("builder.empty")}
          </code>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setRows([emptyRow()])}>
            {t("builder.clear")}
          </Button>
          <Button variant="outline" size="sm" disabled={!filter} onClick={() => apply(false)}>
            {t("builder.apply")}
          </Button>
          <Button size="sm" disabled={!filter} onClick={() => apply(true)}>
            {t("builder.applyRun")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
