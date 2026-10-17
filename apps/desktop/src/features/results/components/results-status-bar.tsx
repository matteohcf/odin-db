import { CircleAlert, Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { formatCount } from "@/lib/format";
import { useResultsState } from "../hooks/use-results";
import type { ResultsController } from "../lib/results-controller";

/** Loaded count, paging state and timing; `actions` adds view-specific controls on the right. */
export function ResultsStatusBar({
  controller,
  actions,
}: {
  controller: ResultsController;
  actions?: ReactNode;
}) {
  const { t } = useTranslation("results");
  const loaded = useResultsState(controller, (s) => s.rows.length);
  const status = useResultsState(controller, (s) => s.status);
  const error = useResultsState(controller, (s) => s.error);
  const hasMore = useResultsState(controller, (s) => s.hasMore);
  const loadingMore = useResultsState(controller, (s) => s.loadingMore);
  const truncated = useResultsState(controller, (s) => s.truncated);
  const durationMs = useResultsState(controller, (s) => s.durationMs);

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
      {status === "ready" && error && (
        <span className="flex items-center gap-1 text-destructive selectable">
          <CircleAlert className="size-3.5" />
          {error}
        </span>
      )}
      <span className="ml-auto flex items-center gap-3">
        {actions}
        {durationMs !== null && (
          <span className="tabular-nums">
            {t("status.duration", { ms: Math.round(durationMs) })}
          </span>
        )}
      </span>
    </footer>
  );
}
