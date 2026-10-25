import type { CreateIndexRequest, IndexInfo } from "@odin-db/bindings";

/** The request that builds `index` again elsewhere, name and options included. */
export function indexRequestOf(index: IndexInfo): CreateIndexRequest {
  return {
    keys: index.keys,
    name: index.name,
    unique: index.unique,
    sparse: index.sparse,
    hidden: index.hidden,
    expireAfterSeconds:
      index.expireAfterSeconds === null ? null : Math.round(index.expireAfterSeconds),
    partialFilter: index.partialFilter,
    collation: index.collation,
  };
}

/** Short labels for what sets an index apart: unique, sparse, hidden, TTL, partial, collation. */
export function indexOptions(index: IndexInfo): string[] {
  return [
    index.unique && "unique",
    index.sparse && "sparse",
    index.hidden && "hidden",
    index.expireAfterSeconds !== null && `TTL ${index.expireAfterSeconds}s`,
    index.partialFilter !== null && "partial",
    index.collation !== null && "collation",
  ].filter((option): option is string => typeof option === "string");
}
