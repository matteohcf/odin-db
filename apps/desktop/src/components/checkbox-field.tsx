import { Checkbox } from "@odin-db/ui/components/checkbox";
import { Label } from "@odin-db/ui/components/label";
import { type ReactNode, useId } from "react";

interface CheckboxFieldProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: ReactNode;
  /** What checking it does, under the label. */
  hint?: ReactNode;
  disabled?: boolean;
}

/** A checkbox with its label and an optional hint, sized for dialogs. */
export function CheckboxField({
  checked,
  onCheckedChange,
  label,
  hint,
  disabled,
}: CheckboxFieldProps) {
  const id = useId();
  return (
    <div className="flex items-start gap-2.5">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(value === true)}
        disabled={disabled}
        className="mt-0.5"
      />
      <div className="flex flex-col gap-0.5">
        <Label htmlFor={id} className="font-normal">
          {label}
        </Label>
        {hint && <span className="text-muted-foreground text-xs">{hint}</span>}
      </div>
    </div>
  );
}
