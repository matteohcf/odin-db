import type { ErrorKind, IpcError } from "@odin-db/bindings";

/** A backend error with its stable classification (ADR-0006). */
class AppError extends Error {
  override name = "AppError";
  readonly kind: ErrorKind;
  /** What the UI needs to act on some errors, e.g. a host key fingerprint. */
  readonly detail: string | null;

  constructor(error: IpcError) {
    super(error.message);
    this.kind = error.kind;
    this.detail = error.detail ?? null;
  }
}

/** An SSH host key to confirm: unknown, or changed since it was trusted (ADR-0036). */
export function hostKeyError(error: unknown): { fingerprint: string; changed: boolean } | null {
  if (!(error instanceof AppError) || !error.detail) return null;
  if (error.kind !== "unknownHostKey" && error.kind !== "hostKeyChanged") return null;
  return { fingerprint: error.detail, changed: error.kind === "hostKeyChanged" };
}

type CommandResult<T> = { status: "ok"; data: T } | { status: "error"; error: IpcError };

/** Unwraps a generated command result, throwing `AppError` so TanStack Query sees failures. */
export async function call<T>(result: Promise<CommandResult<T>>): Promise<T> {
  const outcome = await result;
  if (outcome.status === "error") throw new AppError(outcome.error);
  return outcome.data;
}

/** Backend messages follow Rust's lowercase convention; the UI shows sentence case. */
export function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.charAt(0).toUpperCase() + message.slice(1);
}
