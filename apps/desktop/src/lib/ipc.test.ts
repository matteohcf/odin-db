import { describe, expect, it } from "vitest";
import { call, errorMessage, hostKeyError, isTimeLimitError } from "./ipc";

const failing = (kind: string, detail: string | null = null) =>
  call(
    Promise.resolve({ status: "error", error: { kind, message: "it failed", detail } } as never),
  );

describe("call", () => {
  it("returns the data or throws a classified error", async () => {
    await expect(call(Promise.resolve({ status: "ok", data: 3 }))).resolves.toBe(3);
    const error = await failing("timeLimit").catch((e: unknown) => e);
    expect(isTimeLimitError(error)).toBe(true);
    expect(isTimeLimitError(new Error("timeLimit"))).toBe(false);
    expect(errorMessage(error)).toBe("It failed");
  });

  it("reads host key errors with their fingerprint", async () => {
    const changed = await failing("hostKeyChanged", "SHA256:abc").catch((e: unknown) => e);
    expect(hostKeyError(changed)).toEqual({ fingerprint: "SHA256:abc", changed: true });
    const unknown = await failing("unknownHostKey", "SHA256:abc").catch((e: unknown) => e);
    expect(hostKeyError(unknown)?.changed).toBe(false);
    expect(hostKeyError(await failing("unknownHostKey").catch((e: unknown) => e))).toBeNull();
    expect(hostKeyError(await failing("network", "x").catch((e: unknown) => e))).toBeNull();
  });
});

describe("errorMessage", () => {
  it("shows any thrown value in sentence case", () => {
    expect(errorMessage(new Error("connection refused"))).toBe("Connection refused");
    expect(errorMessage("plain text")).toBe("Plain text");
    expect(errorMessage("")).toBe("");
  });
});
