import type { StreamEvent } from "@odin-db/bindings";
import { describe, expect, it, vi } from "vitest";

const cancelOperation = vi.fn(async () => ({ status: "ok", data: true }));
vi.mock("@odin-db/bindings", () => ({ commands: { cancelOperation } }));
// A channel the test drives: whatever it is handed, it delivers to `onmessage`.
vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage: (message: StreamEvent<unknown>) => void = () => {};
  },
}));

const { startStream } = await import("./streaming");

describe("startStream", () => {
  it("passes data on and settles once on the terminal event", async () => {
    const received: number[] = [];
    let channel: { onmessage: (message: StreamEvent<number>) => void } | undefined;
    const handle = await startStream<number>(
      async (given) => {
        channel = given as unknown as typeof channel;
        return "op-1" as never;
      },
      (data) => received.push(data),
    );
    channel?.onmessage({ event: "data", data: 1 } as StreamEvent<number>);
    channel?.onmessage({ event: "data", data: 2 } as StreamEvent<number>);
    channel?.onmessage({
      event: "failed",
      data: { kind: "database", message: "boom", detail: null },
    } as StreamEvent<number>);
    expect(received).toEqual([1, 2]);
    await expect(handle.done).resolves.toEqual({
      status: "failed",
      error: { kind: "database", message: "boom", detail: null },
    });
    await handle.cancel();
    expect(cancelOperation).toHaveBeenCalledWith("op-1");
  });
});
