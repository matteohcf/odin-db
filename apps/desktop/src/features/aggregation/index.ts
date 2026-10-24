// Public API of the aggregation feature. Other features import only from here.
export { AggregationView } from "./components/aggregation-view";
export { pipelineToText } from "./lib/pipeline";
export { type SavedPipeline, useSavedPipelines } from "./store/saved-pipelines-store";
