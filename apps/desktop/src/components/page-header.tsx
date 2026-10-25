import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface PageHeaderProps {
  /** The same icon as the page's tab. */
  icon: LucideIcon;
  title: ReactNode;
  /** What the page is about: the connection, a count, a short line. */
  subtitle?: ReactNode;
  /** Actions, at the right. */
  children?: ReactNode;
}

/** The header every tab page shares, so pages read alike: icon, title, context, actions. */
export function PageHeader({ icon: Icon, title, subtitle, children }: PageHeaderProps) {
  return (
    <header className="flex h-11 shrink-0 items-center gap-3 border-b px-4">
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-1 items-baseline gap-2">
        {/* The title keeps its width; the context gives way first. */}
        <h1 className="max-w-[70%] shrink-0 truncate font-semibold text-base">{title}</h1>
        {subtitle && (
          <p
            className="min-w-0 truncate text-muted-foreground text-xs"
            title={typeof subtitle === "string" ? subtitle : undefined}
          >
            {subtitle}
          </p>
        )}
      </div>
      {children && <div className="ml-auto flex shrink-0 items-center gap-2">{children}</div>}
    </header>
  );
}
