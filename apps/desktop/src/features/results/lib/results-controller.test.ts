import type { CursorId, DocumentPage } from "@odin-db/bindings";
import { describe, expect, it, vi } from "vitest";
import {
  createResultsController,
  type OpenCursor,
  type ResultsBackend,
} from "./results-controller";

function docs(from: number, count: number) {
  return Array.from({ length: count }, (_, i) => ({ _id: { $numberInt: String(from + i) } }));
}

/** A fake server holding `total` documents behind one cursor. */
function fakeServer(total: number) {
  let served = 0;
  const closed: CursorId[] = [];
  const page = (size: number): DocumentPage => {
    const documents = docs(served, Math.min(size, total - served));
    served += documents.length;
    return { documents, cursorId: served < total ? "c1" : null };
  };
  const open: OpenCursor = async (batchSize) => {
    served = 0;
    return page(batchSize);
  };
  const backend: ResultsBackend = {
    fetchMore: vi.fn(async (_id: CursorId, size: number) => page(size)),
    close: vi.fn((id: CursorId) => closed.push(id)),
  };
  return { open, backend, closed };
}

const noBackend: ResultsBackend = { fetchMore: vi.fn(), close: vi.fn() };

describe("results controller", () => {
  it("pages through a cursor until it is exhausted", async () => {
    const { open, backend } = fakeServer(250);
    const results = createResultsController(backend, { batchSize: 100, maxRows: 10_000 });

    await results.run(open);
    expect(results.store.getState()).toMatchObject({ status: "ready", hasMore: true });
    await results.loadMore();
    await results.loadMore();
    const state = results.store.getState();
    expect(state.rows).toHaveLength(250);
    expect(state.hasMore).toBe(false);
  });

  it("stops at the row cap and releases the cursor", async () => {
    const { open, backend, closed } = fakeServer(1000);
    const results = createResultsController(backend, { batchSize: 100, maxRows: 150 });

    await results.run(open);
    await results.loadMore();
    const state = results.store.getState();
    expect(state.rows).toHaveLength(150);
    expect(state).toMatchObject({ truncated: true, hasMore: false });
    expect(closed).toEqual(["c1"]);
  });

  it("drops a superseded run and closes its cursor", async () => {
    let resolveFirst: (page: DocumentPage) => void = () => {};
    const first: OpenCursor = () =>
      new Promise<DocumentPage>((resolve) => (resolveFirst = resolve));
    const second: OpenCursor = async () => ({ documents: docs(100, 1), cursorId: null });
    const results = createResultsController(noBackend);

    const pending = results.run(first);
    await results.run(second);
    resolveFirst({ documents: docs(0, 5), cursorId: "stale" });
    await pending;

    expect(results.store.getState().rows).toEqual(docs(100, 1));
    expect(noBackend.close).toHaveBeenCalledWith("stale");
  });

  it("keeps rows on screen while refreshing when asked", async () => {
    const results = createResultsController(noBackend);
    await results.run(async () => ({ documents: docs(0, 3), cursorId: null }));
    let resolve: (page: DocumentPage) => void = () => {};
    const refresh = results.run(() => new Promise<DocumentPage>((r) => (resolve = r)), {
      keepRows: true,
    });
    expect(results.store.getState()).toMatchObject({ status: "loading", rows: docs(0, 3) });
    resolve({ documents: docs(10, 1), cursorId: null });
    await refresh;
    expect(results.store.getState().rows).toEqual(docs(10, 1));
  });

  it("collects columns across documents with _id first", async () => {
    const results = createResultsController(noBackend);
    await results.run(async () => ({
      documents: [
        { name: "a", _id: 1 },
        { _id: 2, age: 3 },
      ],
      cursorId: null,
    }));
    expect(results.store.getState().columns).toEqual(["_id", "name", "age"]);
  });

  it("omits _id from columns when no document has it", async () => {
    const results = createResultsController(noBackend);
    await results.run(async () => ({ documents: [{ total: 3 }], cursorId: null }));
    expect(results.store.getState().columns).toEqual(["total"]);
  });

  it("reports errors with sentence-case messages", async () => {
    const results = createResultsController(noBackend);
    await results.run(() => Promise.reject(new Error("boom")));
    expect(results.store.getState()).toMatchObject({ status: "error", error: "Boom" });
  });

  it("releases the cursor on reset and on dispose", async () => {
    const server = fakeServer(500);
    const results = createResultsController(server.backend);
    await results.run(server.open);
    results.reset();
    expect(results.store.getState()).toMatchObject({ status: "idle", rows: [] });
    await results.run(server.open);
    results.dispose();
    expect(server.closed).toEqual(["c1", "c1"]);
  });
});
