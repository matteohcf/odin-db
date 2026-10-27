/** Polls at `interval` until a refetch fails (after its one retry), then waits for a manual retry. */
export const pollUntilError =
  (interval: number | false) =>
  (query: { state: { status: string } }): number | false =>
    query.state.status === "error" ? false : interval;
