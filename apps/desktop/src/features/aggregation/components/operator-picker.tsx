import { Button } from "@odin-db/ui/components/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@odin-db/ui/components/command";
import { Popover, PopoverContent, PopoverTrigger } from "@odin-db/ui/components/popover";
import { cn } from "@odin-db/ui/lib/utils";
import { Check, ChevronsUpDown } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { isWriteOperator, STAGE_OPERATORS, type StageOperator } from "../lib/operators";

interface OperatorPickerProps {
  value: string;
  onChange: (operator: string) => void;
}

/** Searchable list of stage operators with a one-line description each. */
export function OperatorPicker({ value, onChange }: OperatorPickerProps) {
  const { t } = useTranslation("aggregation");
  const [open, setOpen] = useState(false);
  const describe = (operator: string) =>
    STAGE_OPERATORS.some((entry) => entry.operator === operator)
      ? t(`operators.${operator as StageOperator}`)
      : "";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={open}
          aria-label={t("stage.operator")}
          className="h-7 w-40 justify-between font-mono text-xs"
        >
          {value}
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <Command>
          <CommandInput placeholder={t("stage.searchOperator")} />
          <CommandList>
            <CommandEmpty>{t("stage.noOperator")}</CommandEmpty>
            {STAGE_OPERATORS.map(({ operator }) => (
              <CommandItem
                key={operator}
                value={`${operator} ${describe(operator)}`}
                onSelect={() => {
                  onChange(operator);
                  setOpen(false);
                }}
              >
                <Check
                  className={cn("size-3.5", operator === value ? "opacity-100" : "opacity-0")}
                />
                <span
                  className={cn("font-mono text-xs", isWriteOperator(operator) && "text-warning")}
                >
                  {operator}
                </span>
                <span className="truncate text-muted-foreground text-xs">{describe(operator)}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
