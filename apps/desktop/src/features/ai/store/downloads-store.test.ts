import { beforeEach, describe, expect, it, vi } from "vitest";

const streams: {
  resolveId: () => void;
  cancel: ReturnType<typeof vi.fn>;
  settle: (s: string) => void;
}[] = [];

vi.mock("@/lib/streaming", () => ({
  startStream: () =>
    new Promise((resolve) => {
      let settle: (status: string) => void = () => {};
      const done = new Promise((resolveDone) => {
        settle = (status) => resolveDone({ status });
      });
      const cancel = vi.fn(async () => {
        settle("cancelled");
        return true;
      });
      streams.push({ resolveId: () => resolve({ id: "op", done, cancel }), cancel, settle });
    }),
}));
vi.mock("@/lib/ipc", () => ({ call: vi.fn(), errorMessage: String }));

const { useModelDownloads } = await import("./downloads-store");

describe("useModelDownloads", () => {
  beforeEach(() => {
    streams.length = 0;
    useModelDownloads.setState({ downloads: {} });
  });

  it("pausing before the operation id arrives still cancels it", async () => {
    const outcome = useModelDownloads.getState().start("m");
    useModelDownloads.getState().pause("m");
    streams[0]?.resolveId();
    await expect(outcome).resolves.toEqual({ status: "paused" });
    expect(streams[0]?.cancel).toHaveBeenCalledOnce();
    expect(useModelDownloads.getState().downloads).toEqual({});
  });

  it("reports an installed model", async () => {
    const outcome = useModelDownloads.getState().start("m");
    await vi.waitFor(() => expect(streams).toHaveLength(1));
    streams[0]?.resolveId();
    await vi.waitFor(() => expect(useModelDownloads.getState().downloads.m?.handle).toBeTruthy());
    streams[0]?.settle("completed");
    await expect(outcome).resolves.toEqual({ status: "installed" });
  });
});
