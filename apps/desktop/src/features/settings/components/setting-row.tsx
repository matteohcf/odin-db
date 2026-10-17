import { Label } from "@odin-db/ui/components/label";
import type { ReactNode } from "react";

interface SettingRowProps {
  /** Id of the control, so the label focuses it. */
  id?: string;
  label: string;
  description?: ReactNode;
  children: ReactNode;
}

/** One setting: what it is on the left, its control on the right. */
export function SettingRow({ id, label, description, children }: SettingRowProps) {
  return (
    <div className="flex items-center justify-between gap-6 px-4 py-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        {id ? (
          <Label htmlFor={id} className="font-medium text-sm">
            {label}
          </Label>
        ) : (
          <span className="font-medium text-sm">{label}</span>
        )}
        {description && <span className="text-muted-foreground text-xs">{description}</span>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}
