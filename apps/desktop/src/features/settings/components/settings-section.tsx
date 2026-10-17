import type { ReactNode } from "react";

interface SettingsSectionProps {
  title: string;
  description?: string;
  children: ReactNode;
}

/** A titled group of settings rows, drawn as one card. */
export function SettingsSection({ title, description, children }: SettingsSectionProps) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 className="font-semibold text-base">{title}</h2>
        {description && <p className="text-muted-foreground text-sm">{description}</p>}
      </div>
      <div className="divide-y rounded-lg border bg-card">{children}</div>
    </section>
  );
}
