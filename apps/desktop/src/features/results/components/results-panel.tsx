import { CircleAlert, Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useResultsState } from "../hooks/use-results";
import type { ResultsController } from "../lib/results-controller";
import { useResultsView } from "../store/results-view-store";
import { DocumentPreview } from "./document-preview";
import { type ColumnActions, ResultsGrid, type RowActions } from "./results-grid";
import { ResultsList } from "./results-list";

interface ResultsPanelProps {
  controller: ResultsController;
  label: string;
  /** Shown when a run returns no documents. */
  empty: ReactNode;
  /** Shown before the first run. */
  idle?: ReactNode;
  selectedIndex: number | null;
  onSelect: (index: number | null) => void;
  actions: RowActions;
  columnActions?: ColumnActions | undefined;
}

/** Results area: loading, error, empty and grid states for one controller. */
export function ResultsPanel({
  controller,
  label,
  empty,
  idle,
  selectedIndex,
  onSelect,
  actions,
  columnActions,
}: ResultsPanelProps) {
  const { t } = useTranslation("results");
  const rows = useResultsState(controller, (s) => s.rows);
  const columns = useResultsState(controller, (s) => s.columns);
  const status = useResultsState(controller, (s) => s.status);
  const error = useResultsState(controller, (s) => s.error);
  const hasMore = useResultsState(controller, (s) => s.hasMore);
  const loadMore = useCallback(() => void controller.loadMore(), [controller]);
  const view = useResultsView((s) => s.view);
  const preview = useResultsView((s) => s.preview);

  if (status === "idle") return <div className="flex-1">{idle}</div>;
  if (status === "error") {
    return (
      <div className="flex flex-1 flex-col items-start gap-2 p-6">
        <p className="flex items-center gap-2 font-medium text-destructive">
          <CircleAlert className="size-4" />
          {t("failed")}
        </p>
        <p className="max-w-2xl text-muted-foreground text-xs selectable">{error}</p>
      </div>
    );
  }
  if (status === "loading" && rows.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        {t("loading")}
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
        {empty}
      </div>
    );
  }
  if (view === "list" || view === "json") {
    return (
      <ResultsList
        format={view === "list" ? "tree" : "json"}
        label={label}
        rows={rows}
        hasMore={hasMore}
        selectedIndex={selectedIndex}
        onSelect={onSelect}
        onLoadMore={loadMore}
        actions={actions}
      />
    );
  }
  const grid = (
    <ResultsGrid
      label={label}
      rows={rows}
      columns={columns}
      hasMore={hasMore}
      selectedIndex={selectedIndex}
      onSelect={onSelect}
      onLoadMore={loadMore}
      actions={actions}
      columnActions={columnActions}
    />
  );
  // The same wrapper with or without the preview, so toggling it keeps the grid mounted.
  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">{grid}</div>
      {preview && (
        <DocumentPreview
          document={selectedIndex === null ? undefined : rows[selectedIndex]}
          onFilter={columnActions?.onFilterBy}
        />
      )}
    </div>
  );
}
