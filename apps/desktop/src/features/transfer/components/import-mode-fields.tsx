import type { ImportMode } from "@odin-db/bindings";
import { Checkbox } from "@odin-db/ui/components/checkbox";
import { Input } from "@odin-db/ui/components/input";
import { Label } from "@odin-db/ui/components/label";
import { RadioGroup, RadioGroupItem } from "@odin-db/ui/components/radio-group";
import { useId } from "react";
import { useTranslation } from "react-i18next";

export interface ImportModeValue {
  mode: ImportMode;
  dropFirst: boolean;
  confirmation: string;
}

export const DEFAULT_IMPORT_MODE: ImportModeValue = {
  mode: "insert",
  dropFirst: false,
  confirmation: "",
};

/** Emptying first destroys data, so it needs the target's name typed out. */
export function importModeReady(value: ImportModeValue, target: string) {
  return !value.dropFirst || value.confirmation === target;
}

interface ImportModeFieldsProps {
  value: ImportModeValue;
  onChange: (value: ImportModeValue) => void;
  /** What "empty first" empties: the collection or the database's collections. */
  scope: "collection" | "database" | "copyCollection" | "copyDatabase";
  /** Name to type to confirm emptying. */
  target: string;
}

/** How imported documents meet existing ones, and whether to empty first. */
export function ImportModeFields({ value, onChange, scope, target }: ImportModeFieldsProps) {
  const { t } = useTranslation("transfer");
  const id = useId();
  return (
    <div className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 font-medium text-sm">{t("mode.title")}</legend>
        <RadioGroup
          value={value.mode}
          onValueChange={(mode) => onChange({ ...value, mode: mode as ImportMode })}
        >
          {(["insert", "upsert", "merge"] as const).map((mode) => (
            <div key={mode} className="flex items-start gap-2.5">
              <RadioGroupItem id={`${id}-${mode}`} value={mode} className="mt-0.5" />
              <div className="flex flex-col gap-0.5">
                <Label htmlFor={`${id}-${mode}`} className="font-normal">
                  {t(`mode.${mode}`)}
                </Label>
                <span className="text-muted-foreground text-xs">{t(`mode.${mode}Hint`)}</span>
              </div>
            </div>
          ))}
        </RadioGroup>
      </fieldset>

      <div className="flex flex-col gap-2">
        <div className="flex items-start gap-2.5">
          <Checkbox
            id={`${id}-drop`}
            checked={value.dropFirst}
            onCheckedChange={(checked) =>
              onChange({ ...value, dropFirst: checked === true, confirmation: "" })
            }
            className="mt-0.5"
          />
          <div className="flex flex-col gap-0.5">
            <Label htmlFor={`${id}-drop`} className="font-normal">
              {t(`mode.dropFirst.${scope}`)}
            </Label>
            <span className="text-muted-foreground text-xs">
              {t(`mode.dropFirst.${scope}Hint`)}
            </span>
          </div>
        </div>
        {value.dropFirst && (
          <div className="flex flex-col gap-1.5 rounded-md border border-destructive/40 bg-destructive/5 p-2.5">
            <Label htmlFor={`${id}-confirm`} className="text-destructive text-xs">
              {t("mode.dropFirst.confirm", { name: target })}
            </Label>
            <Input
              id={`${id}-confirm`}
              value={value.confirmation}
              onChange={(event) => onChange({ ...value, confirmation: event.target.value })}
              autoComplete="off"
              spellCheck={false}
              className="h-8 font-mono text-xs"
            />
          </div>
        )}
      </div>
    </div>
  );
}
