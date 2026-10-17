import { cn } from "@odin-db/ui/lib/utils";
import type { ReactNode } from "react";
import { useSettingsSearch } from "../hooks/use-settings-search";

interface SettingsSectionProps {
  title: string;
  description?: string;
  children: ReactNode;
}

/** A titled group of settings rows, drawn as one card. */
export function SettingsSection({ title, description, children }: SettingsSectionProps) {
  const search = useSettingsSearch();
  return (
    <section
      className={cn(
        "flex flex-col gap-3",
        // While searching, a section without a matching row disappears.
        search && "[&:not(:has([data-setting-row]))]:hidden",
      )}
    >
      <div className="flex flex-col gap-0.5">
        <h2 className="font-semibold text-base">{title}</h2>
        {description && <p className="text-muted-foreground text-sm">{description}</p>}
      </div>
      <div className="divide-y rounded-lg border bg-card">{children}</div>
    </section>
  );
}
