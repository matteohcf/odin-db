import { Button } from "@odin-db/ui/components/button";
import { CircleAlert, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatCount } from "@/lib/format";

interface StatusBarProps {
  loaded: number;
  hasMore: boolean;
  loadingMore: boolean;
  truncated: boolean;
  durationMs: number | null;
  pageError: string | null;
  count: { pending: boolean; value: number | undefined; onCount: () => void };
}

export function StatusBar({
  loaded,
  hasMore,
  loadingMore,
  truncated,
  durationMs,
  pageError,
  count,
}: StatusBarProps) {
  const { t } = useTranslation("documents");

  return (
    <footer className="flex h-8 shrink-0 items-center gap-3 border-t bg-sidebar px-3 text-muted-foreground text-xs">
      <span className="text-foreground tabular-nums">{t("status.loaded", { count: loaded })}</span>
      {loadingMore && <Loader2 className="size-3 animate-spin" />}
      {hasMore && !loadingMore && <span>{t("status.more")}</span>}
      {truncated && (
        <span className="flex items-center gap-1 text-warning">
          <CircleAlert className="size-3.5" />
          {t("status.truncated", { count: formatCount(loaded) })}
        </span>
      )}
      {pageError && (
        <span className="flex items-center gap-1 text-destructive selectable">
          <CircleAlert className="size-3.5" />
          {pageError}
        </span>
      )}
      <span className="ml-auto flex items-center gap-3">
        {count.value !== undefined && (
          <span className="tabular-nums">{t("status.counted", { count: count.value })}</span>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={count.onCount}
          disabled={count.pending}
        >
          {count.pending ? t("status.counting") : t("status.count")}
        </Button>
        {durationMs !== null && (
          <span className="tabular-nums">
            {t("status.duration", { ms: Math.round(durationMs) })}
          </span>
        )}
      </span>
    </footer>
  );
}
