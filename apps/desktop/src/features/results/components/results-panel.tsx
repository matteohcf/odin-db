import { CircleAlert } from "lucide-react";
import type { ReactNode } from "react";
import {
  lazy,
  Suspense,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useShortcut } from "@/hooks/use-shortcut";
import { useFindHighlight } from "../hooks/use-find-highlight";
import { useResultsState } from "../hooks/use-results";
import { findMatches, matchKey, stepMatch } from "../lib/find";
import { stepInto } from "../lib/nested";
import type { ResultsController } from "../lib/results-controller";
import { useResultsView } from "../store/results-view-store";
import { DocumentPreview } from "./document-preview";
import { FindBar } from "./find-bar";
import { NestedPath } from "./nested-path";
import { type ColumnActions, type FindTarget, ResultsGrid, type RowActions } from "./results-grid";
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
  /** Remembers the table's column arrangement under this key. */
  layoutKey?: string | undefined;
  /** Whether this panel's tab is the visible one, which Find (Mod+F) acts on. */
  active?: boolean | undefined;
}

// Charts bring recharts along: loaded the first time someone looks at one.
const ResultsChart = lazy(() =>
  import("./results-chart").then((module) => ({ default: module.ResultsChart })),
);

const SKELETON_ROWS = Array.from({ length: 14 }, (_, index) => index);
const SKELETON_COLUMNS = [150, 110, 170, 60, 90, 120];

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
  layoutKey,
  active = true,
}: ResultsPanelProps) {
  const { t } = useTranslation("results");
  const rows = useResultsState(controller, (s) => s.rows);
  const columns = useResultsState(controller, (s) => s.columns);
  const status = useResultsState(controller, (s) => s.status);
  const error = useResultsState(controller, (s) => s.error);
  const timedOut = useResultsState(controller, (s) => s.timedOut);
  const hasMore = useResultsState(controller, (s) => s.hasMore);
  const loadMore = useCallback(() => void controller.loadMore(), [controller]);
  const view = useResultsView((s) => s.view);
  const preview = useResultsView((s) => s.preview);
  // Stepped into arrays or embedded documents: their values as rows, read-only.
  const [path, setPath] = useState<readonly string[]>([]);
  const nested = useMemo(() => (path.length > 0 ? stepInto(rows, path) : null), [rows, path]);
  const [nestedSelection, setNestedSelection] = useState<number | null>(null);
  // New rows (a re-run, more loaded) make the selected index point elsewhere.
  // biome-ignore lint/correctness/useExhaustiveDependencies: rows changing is the trigger.
  useEffect(() => setNestedSelection(null), [rows]);
  // A field the new results no longer have leaves nothing to stand in.
  useEffect(() => {
    if (path[0] !== undefined && !columns.includes(path[0])) setPath([]);
  }, [columns, path]);

  // Find in results (Mod+F): over the loaded documents, the rows on screen being only some.
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findIndex, setFindIndex] = useState(-1);
  const [findSeq, setFindSeq] = useState(0);
  const findInput = useRef<HTMLInputElement>(null);
  const [findRoot, setFindRoot] = useState<HTMLDivElement | null>(null);
  const findable = view !== "chart" && rows.length > 0;
  const finding = findOpen && findable;
  const query = useDeferredValue(findQuery);
  const table = view === "table";
  const findRows = table && nested ? nested.rows : rows;
  const findColumns = table ? (nested ? nested.columns : columns) : undefined;
  const matches = useMemo(
    () => (finding ? findMatches(findRows, query, findColumns) : []),
    [finding, findRows, query, findColumns],
  );
  const matched = useMemo(
    () => new Set(matches.map((each) => matchKey(each.row, each.field))),
    [matches],
  );
  const match = matches[findIndex];
  const findCurrent: FindTarget | null = match ? { ...match, seq: findSeq } : null;

  function goToMatch(index: number) {
    setFindIndex(index);
    setFindSeq((seq) => seq + 1);
    const next = matches[index];
    if (!next) return;
    if (table && nested) setNestedSelection(next.row);
    else onSelect(next.row);
  }
  // New text starts again from the first match, as a browser does; more rows keep the place.
  // biome-ignore lint/correctness/useExhaustiveDependencies: new text, or a new view, is the trigger.
  useEffect(() => {
    if (finding) goToMatch(matches.length > 0 ? 0 : -1);
  }, [query, view, path, finding]);
  useFindHighlight(findRoot, query, finding && active);
  useShortcut(
    "find",
    () => {
      setFindOpen(true);
      // Already open: back to the text, selected, ready to be replaced.
      findInput.current?.focus();
      findInput.current?.select();
    },
    active && findable,
  );
  function closeFind() {
    setFindOpen(false);
    findRoot?.querySelector<HTMLElement>('[role="grid"], [role="listbox"]')?.focus();
  }
  const findBar = finding && (
    <FindBar
      inputRef={findInput}
      query={findQuery}
      onQuery={setFindQuery}
      count={matches.length}
      current={findIndex}
      onStep={(step) => goToMatch(stepMatch(findIndex, matches.length, step))}
      onClose={closeFind}
    />
  );

  if (status === "idle") return <div className="flex-1">{idle}</div>;
  if (status === "error") {
    return (
      <div className="flex flex-1 flex-col items-start gap-2 p-6">
        <p className="flex items-center gap-2 font-medium text-destructive">
          <CircleAlert className="size-4" />
          {t("failed")}
        </p>
        <p className="max-w-2xl text-muted-foreground text-xs selectable">{error}</p>
        {timedOut && <p className="max-w-2xl text-xs">{t("timedOut")}</p>}
      </div>
    );
  }
  if (status === "loading" && rows.length === 0) {
    // Placeholder rows, shown only if the first page is slow, so fast queries do not flash.
    return (
      <div
        role="status"
        aria-label={t("loading")}
        className="flex flex-1 flex-col overflow-hidden fade-in animate-in fill-mode-both delay-200 duration-300"
      >
        <div className="h-8 shrink-0 border-b bg-sidebar" />
        {SKELETON_ROWS.map((row) => (
          <div
            key={row}
            className="flex h-[30px] shrink-0 items-center gap-6 border-b border-border/60 px-4"
          >
            <div className="h-2.5 w-6 animate-pulse rounded bg-muted" />
            {SKELETON_COLUMNS.map((width, column) => (
              <div
                key={width}
                className="h-2.5 animate-pulse rounded bg-muted"
                style={{
                  width: width - ((row * 7 + column * 13) % 40),
                  animationDelay: `${row * 40}ms`,
                }}
              />
            ))}
          </div>
        ))}
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
  if (view === "chart") {
    return (
      <Suspense fallback={<div className="flex-1" />}>
        <ResultsChart rows={rows} hasMore={hasMore} onLoadMore={loadMore} />
      </Suspense>
    );
  }
  if (view === "list" || view === "json") {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {findBar}
        <div ref={setFindRoot} className="flex min-h-0 flex-1 flex-col">
          <ResultsList
            format={view === "list" ? "tree" : "json"}
            label={label}
            rows={rows}
            hasMore={hasMore}
            selectedIndex={selectedIndex}
            onSelect={onSelect}
            onLoadMore={loadMore}
            actions={actions}
            findCurrent={findCurrent}
          />
        </div>
      </div>
    );
  }
  const openPath = (next: readonly string[]) => {
    setNestedSelection(null);
    setPath(next);
  };
  const grid = nested ? (
    <>
      <NestedPath label={label} path={path} onOpen={openPath} count={nested.rows.length} />
      <ResultsGrid
        // A layout of its own per path: its columns are not the documents'.
        key={path.join("\u0000")}
        label={label}
        rows={nested.rows}
        columns={nested.columns}
        hasMore={false}
        selectedIndex={nestedSelection}
        onSelect={setNestedSelection}
        onLoadMore={loadMore}
        actions={{ onOpen: () => {}, openMode: "view", onCopy: actions.onCopy }}
        onStepInto={(field) => openPath([...path, field])}
        findCurrent={findCurrent}
        findMatched={matched}
      />
    </>
  ) : (
    <ResultsGrid
      label={label}
      layoutKey={layoutKey}
      rows={rows}
      columns={columns}
      hasMore={hasMore}
      selectedIndex={selectedIndex}
      onSelect={onSelect}
      onLoadMore={loadMore}
      actions={actions}
      columnActions={columnActions}
      onStepInto={(field) => openPath([field])}
      findCurrent={findCurrent}
      findMatched={matched}
    />
  );
  // The same wrapper with or without the preview, so toggling it keeps the grid mounted.
  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        {findBar}
        <div ref={setFindRoot} className="flex min-h-0 flex-1 flex-col">
          {grid}
        </div>
      </div>
      {preview && (
        <DocumentPreview
          document={
            nested
              ? nestedSelection === null
                ? undefined
                : nested.rows[nestedSelection]
              : selectedIndex === null
                ? undefined
                : rows[selectedIndex]
          }
          // Nested fields are not top-level fields of the query: no filtering from them.
          onFilter={nested ? undefined : columnActions?.onFilterBy}
        />
      )}
    </div>
  );
}
