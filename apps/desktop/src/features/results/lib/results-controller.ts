import type { CursorId, DocumentPage } from "@odin-db/bindings";
import { createStore } from "zustand/vanilla";
import { isJsonObject, type JsonObject } from "@/lib/ejson-display";
import { errorMessage, isTimeLimitError } from "@/lib/ipc";

/** Opens a server cursor (a find, an aggregate…) and returns its first page. */
export type OpenCursor = (batchSize: number) => Promise<DocumentPage>;

export interface ResultsBackend {
  fetchMore: (cursorId: CursorId, batchSize: number) => Promise<DocumentPage>;
  close: (cursorId: CursorId) => void;
}

export interface ResultsState {
  rows: JsonObject[];
  /** Union of top-level fields in first-seen order, `_id` first. */
  columns: string[];
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  /** The error is the server's time limit, which the user can raise. */
  timedOut: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  /** The row cap was reached; more documents exist on the server. */
  truncated: boolean;
  durationMs: number | null;
}

export interface ResultsOptions {
  batchSize: number;
  /** Bounds webview memory (docs/milestone-0.md, finding 3). */
  maxRows: number;
}

const defaultResultsOptions: ResultsOptions = { batchSize: 100, maxRows: 20_000 };

const initialState: ResultsState = {
  rows: [],
  columns: [],
  status: "idle",
  error: null,
  timedOut: false,
  loadingMore: false,
  hasMore: false,
  truncated: false,
  durationMs: null,
};

/**
 * Runs queries and pages through their server cursor on demand (ADR-0025).
 * Every run gets a generation number: late answers from a superseded run are
 * dropped and their cursors closed, so results never mix between queries.
 */
export function createResultsController(
  backend: ResultsBackend,
  options: ResultsOptions = defaultResultsOptions,
) {
  const store = createStore<ResultsState>()(() => initialState);
  let generation = 0;
  let cursorId: CursorId | null = null;
  let seenColumns = new Set<string>();

  function releaseCursor() {
    if (cursorId) backend.close(cursorId);
    cursorId = null;
  }

  function appendPage(page: DocumentPage, replace: boolean) {
    const incoming = page.documents.filter(isJsonObject);
    const current = replace ? [] : store.getState().rows;
    const room = options.maxRows - current.length;
    const rows = current.concat(room < incoming.length ? incoming.slice(0, room) : incoming);
    const capped = rows.length >= options.maxRows && page.cursorId !== null;

    if (replace) seenColumns = new Set(["_id"]);
    const columns = replace ? ["_id"] : [...store.getState().columns];
    for (const row of incoming) {
      for (const key of Object.keys(row)) {
        if (!seenColumns.has(key)) {
          seenColumns.add(key);
          columns.push(key);
        }
      }
    }
    if (replace && !incoming.some((row) => "_id" in row)) columns.shift();

    cursorId = page.cursorId;
    if (capped) releaseCursor();
    store.setState({
      rows,
      columns,
      hasMore: cursorId !== null,
      truncated: capped,
    });
  }

  /**
   * `keepRows` leaves the current rows on screen until the new first page arrives,
   * so refreshing after an edit doesn't flash an empty grid.
   */
  async function run(open: OpenCursor, { keepRows = false }: { keepRows?: boolean } = {}) {
    generation += 1;
    const current = generation;
    releaseCursor();
    store.setState(
      keepRows
        ? { status: "loading", error: null, hasMore: false, loadingMore: false }
        : { ...initialState, status: "loading", columns: store.getState().columns },
    );
    const startedAt = performance.now();

    try {
      const page = await open(options.batchSize);
      if (current !== generation) {
        if (page.cursorId) backend.close(page.cursorId);
        return;
      }
      appendPage(page, true);
      store.setState({ status: "ready", durationMs: performance.now() - startedAt });
    } catch (error) {
      if (current === generation) {
        store.setState({
          ...initialState,
          status: "error",
          error: errorMessage(error),
          timedOut: isTimeLimitError(error),
        });
      }
    }
  }

  async function loadMore() {
    const state = store.getState();
    if (!cursorId || state.loadingMore || state.status !== "ready") return;
    const current = generation;
    store.setState({ loadingMore: true });

    try {
      const page = await backend.fetchMore(cursorId, options.batchSize);
      if (current !== generation) return;
      appendPage(page, false);
    } catch (error) {
      if (current !== generation) return;
      cursorId = null;
      store.setState({ hasMore: false, error: errorMessage(error) });
    } finally {
      if (current === generation) store.setState({ loadingMore: false });
    }
  }

  /** Back to the empty state, e.g. when the query that produced the rows is gone. */
  function reset() {
    generation += 1;
    releaseCursor();
    store.setState(initialState);
  }

  function dispose() {
    generation += 1;
    releaseCursor();
  }

  return { store, run, loadMore, reset, dispose };
}

export type ResultsController = ReturnType<typeof createResultsController>;
