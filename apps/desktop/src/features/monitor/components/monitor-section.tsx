import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface MonitorSectionProps {
  title: string;
  icon?: LucideIcon;
  /** Beside the title: a count, a name, a state. */
  detail?: ReactNode;
  /** At the right of the title row. */
  actions?: ReactNode;
  children: ReactNode;
}

/** One section of the server status page: a titled block, named for screen readers. */
export function MonitorSection({
  title,
  icon: Icon,
  detail,
  actions,
  children,
}: MonitorSectionProps) {
  return (
    <section className="mt-6 flex flex-col gap-2" aria-label={title}>
      <div className="flex flex-wrap items-center gap-2">
        {Icon && <Icon className="size-4 text-warning" />}
        <h2 className="font-semibold text-sm">{title}</h2>
        {detail}
        {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}
