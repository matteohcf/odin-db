import { Label } from "@odin-db/ui/components/label";
import type { ReactNode } from "react";
import { useSettingsSearch } from "../hooks/use-settings-search";

interface SettingRowProps {
  /** Id of the control, so the label focuses it. */
  id?: string;
  label: string;
  /** Shown after the label, e.g. "Recommended". */
  badges?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}

/** One setting: what it is on the left, its control on the right. */
export function SettingRow({ id, label, badges, description, children }: SettingRowProps) {
  const search = useSettingsSearch();
  const text = `${label} ${typeof description === "string" ? description : ""}`.toLowerCase();
  if (search && !text.includes(search)) return null;
  return (
    <div data-setting-row className="flex items-center justify-between gap-6 px-4 py-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          {id ? (
            <Label htmlFor={id} className="font-medium text-sm">
              {label}
            </Label>
          ) : (
            <span className="font-medium text-sm">{label}</span>
          )}
          {badges}
        </div>
        {description && <span className="text-muted-foreground text-xs">{description}</span>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}
