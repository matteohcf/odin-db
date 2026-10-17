import type { CursorId, DocumentPage, FindRequest } from "@odin-db/bindings";
import { describe, expect, it, vi } from "vitest";
import { createResultsController, type ResultsBackend } from "./results-controller";

const query = { filter: {}, projection: null, sort: null, skip: null, limit: null };

function docs(from: number, count: number, extra: Record<string, unknown> = {}) {
  return Array.from({ length: count }, (_, i) => ({
    _id: { $numberInt: String(from + i) },
    ...extra,
  }));
}

/** A fake server holding `total` documents behind one cursor. */
function fakeBackend(total: number) {
  let served = 0;
  const closed: CursorId[] = [];
  const page = (size: number): DocumentPage => {
    const documents = docs(served, Math.min(size, total - served));
    served += documents.length;
    return { documents, cursorId: served < total ? "c1" : null };
  };
  const backend: ResultsBackend = {
    find: vi.fn(async (request: FindRequest) => {
      served = 0;
      return page(request.batchSize);
    }),
    fetchMore: vi.fn(async (_id: CursorId, size: number) => page(size)),
    close: vi.fn((id: CursorId) => closed.push(id)),
  };
  return { backend, closed };
}

describe("results controller", () => {
  it("pages through a cursor until it is exhausted", async () => {
    const { backend } = fakeBackend(250);
    const results = createResultsController(backend, { batchSize: 100, maxRows: 10_000 });

    await results.run(query);
    expect(results.store.getState()).toMatchObject({ status: "ready", hasMore: true });
    await results.loadMore();
    await results.loadMore();
    const state = results.store.getState();
    expect(state.rows).toHaveLength(250);
    expect(state.hasMore).toBe(false);
  });

  it("stops at the row cap and releases the cursor", async () => {
    const { backend, closed } = fakeBackend(1000);
    const results = createResultsController(backend, { batchSize: 100, maxRows: 150 });

    await results.run(query);
    await results.loadMore();
    const state = results.store.getState();
    expect(state.rows).toHaveLength(150);
    expect(state).toMatchObject({ truncated: true, hasMore: false });
    expect(closed).toEqual(["c1"]);
  });

  it("drops a superseded run and closes its cursor", async () => {
    let resolveFirst: (page: DocumentPage) => void = () => {};
    const backend: ResultsBackend = {
      find: vi
        .fn()
        .mockImplementationOnce(() => new Promise<DocumentPage>((r) => (resolveFirst = r)))
        .mockResolvedValueOnce({ documents: docs(100, 1), cursorId: null }),
      fetchMore: vi.fn(),
      close: vi.fn(),
    };
    const results = createResultsController(backend);

    const first = results.run(query);
    await results.run(query);
    resolveFirst({ documents: docs(0, 5), cursorId: "stale" });
    await first;

    expect(results.store.getState().rows).toEqual(docs(100, 1));
    expect(backend.close).toHaveBeenCalledWith("stale");
  });

  it("collects columns across documents with _id first", async () => {
    const backend: ResultsBackend = {
      find: vi.fn().mockResolvedValue({
        documents: [
          { name: "a", _id: 1 },
          { _id: 2, age: 3 },
        ],
        cursorId: null,
      }),
      fetchMore: vi.fn(),
      close: vi.fn(),
    };
    const results = createResultsController(backend);
    await results.run(query);
    expect(results.store.getState().columns).toEqual(["_id", "name", "age"]);
  });

  it("reports errors and closes the cursor on dispose", async () => {
    const failing: ResultsBackend = {
      find: vi.fn().mockRejectedValue(new Error("boom")),
      fetchMore: vi.fn(),
      close: vi.fn(),
    };
    const results = createResultsController(failing);
    await results.run(query);
    expect(results.store.getState()).toMatchObject({ status: "error", error: "Boom" });

    const { backend, closed } = fakeBackend(500);
    const paged = createResultsController(backend);
    await paged.run(query);
    paged.dispose();
    expect(closed).toEqual(["c1"]);
  });
});
