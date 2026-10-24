import type { SavedPipeline } from "@/features/aggregation";
import type { QueryForm } from "@/features/documents";

/** A saved query or pipeline, with where it belongs. */
export type SavedItem = {
  key: string;
  profileId: string;
  database: string;
  collection: string;
  savedAt: number;
} & (
  | { kind: "query"; form: QueryForm }
  | { kind: "pipeline"; name: string; pipeline: SavedPipeline }
);

/** Both stores key their entries by `JSON.stringify([profileId, database, collection])`. */
function place(key: string): { profileId: string; database: string; collection: string } | null {
  try {
    const [profileId, database, collection] = JSON.parse(key) as unknown[];
    return typeof profileId === "string" &&
      typeof database === "string" &&
      typeof collection === "string"
      ? { profileId, database, collection }
      : null;
  } catch {
    return null;
  }
}

/** Every saved query and pipeline, newest first. */
export function savedItems(
  queries: Readonly<Record<string, readonly { form: QueryForm; ranAt: number }[]>>,
  pipelines: Readonly<Record<string, readonly SavedPipeline[]>>,
): SavedItem[] {
  const items: SavedItem[] = [];
  for (const [key, entries] of Object.entries(queries)) {
    const where = place(key);
    if (!where) continue;
    for (const entry of entries) {
      items.push({ key, ...where, savedAt: entry.ranAt, kind: "query", form: entry.form });
    }
  }
  for (const [key, entries] of Object.entries(pipelines)) {
    const where = place(key);
    if (!where) continue;
    for (const pipeline of entries) {
      items.push({
        key,
        ...where,
        savedAt: pipeline.savedAt,
        kind: "pipeline",
        name: pipeline.name,
        pipeline,
      });
    }
  }
  return items.sort((a, b) => b.savedAt - a.savedAt);
}

/** What a search matches: the collection, the pipeline's name, and the query or stage text. */
export function searchText(item: SavedItem, profileName: string): string {
  const body =
    item.kind === "query"
      ? Object.values(item.form).join(" ")
      : `${item.name} ${item.pipeline.stages.map((stage) => `${stage.operator} ${stage.body}`).join(" ")}`;
  return `${profileName} ${item.database}.${item.collection} ${body}`.toLowerCase();
}
