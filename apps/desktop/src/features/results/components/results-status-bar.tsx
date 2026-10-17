import { ToggleGroup, ToggleGroupItem } from "@odin-db/ui/components/toggle-group";
import { Braces, CircleAlert, List, Loader2, Table2 } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { formatCount } from "@/lib/format";
import { useResultsState } from "../hooks/use-results";
import type { ResultsController } from "../lib/results-controller";
import { type ResultsView, useResultsView } from "../store/results-view-store";

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
  const view = useResultsView((s) => s.view);
  const setView = useResultsView((s) => s.setView);

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
        <ToggleGroup
          type="single"
          size="sm"
          value={view}
          onValueChange={(value) => value && setView(value as ResultsView)}
          aria-label={t("view.label")}
          className="h-6"
        >
          <ToggleGroupItem
            value="table"
            aria-label={t("view.table")}
            title={t("view.table")}
            className="h-6 px-1.5"
          >
            <Table2 className="size-3.5" />
          </ToggleGroupItem>
          <ToggleGroupItem
            value="list"
            aria-label={t("view.list")}
            title={t("view.list")}
            className="h-6 px-1.5"
          >
            <List className="size-3.5" />
          </ToggleGroupItem>
          <ToggleGroupItem
            value="json"
            aria-label={t("view.json")}
            title={t("view.json")}
            className="h-6 px-1.5"
          >
            <Braces className="size-3.5" />
          </ToggleGroupItem>
        </ToggleGroup>
      </span>
    </footer>
  );
}
