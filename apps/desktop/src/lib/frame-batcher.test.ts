import { afterEach, describe, expect, it, vi } from "vitest";
import { createFrameBatcher } from "./frame-batcher";

// A frame clock the test advances by hand.
let frames: (() => void)[] = [];
vi.stubGlobal("requestAnimationFrame", (callback: () => void) => frames.push(callback));
vi.stubGlobal("cancelAnimationFrame", (id: number) => {
  frames[id - 1] = () => {};
});
const nextFrame = () => {
  const due = frames;
  frames = [];
  for (const callback of due) callback();
};

afterEach(() => {
  frames = [];
});

describe("createFrameBatcher", () => {
  it("delivers everything pushed within a frame in one flush", () => {
    const flush = vi.fn();
    const batcher = createFrameBatcher<number>(flush);
    batcher.push([1, 2]);
    batcher.push([3]);
    expect(flush).not.toHaveBeenCalled();
    nextFrame();
    expect(flush).toHaveBeenCalledOnce();
    expect(flush).toHaveBeenCalledWith([1, 2, 3]);
  });

  it("flushes now on demand, and drops what is pending on cancel", () => {
    const flush = vi.fn();
    const batcher = createFrameBatcher<string>(flush);
    batcher.push(["a"]);
    batcher.flushNow();
    expect(flush).toHaveBeenLastCalledWith(["a"]);
    batcher.push(["b"]);
    batcher.cancel();
    nextFrame();
    expect(flush).toHaveBeenCalledOnce();
    // Pushing again after a cancel schedules a new frame.
    batcher.push(["c"]);
    nextFrame();
    expect(flush).toHaveBeenLastCalledWith(["c"]);
  });
});
