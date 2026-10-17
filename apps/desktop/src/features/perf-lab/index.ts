// Public API of the perf-lab feature (Milestone 0 benchmarks, `--perf-autorun`).
// The lab itself is imported lazily by the app so its dependencies stay out of the main chunk.
export { useAutorunEnabled } from "./api/use-autorun-enabled";
