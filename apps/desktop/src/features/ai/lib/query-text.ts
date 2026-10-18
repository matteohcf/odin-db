import type { GeneratedQuery } from "@odin-db/bindings";
import { isJsonObject } from "@/lib/ejson-display";
import { toShellSyntax } from "@/lib/shell-syntax";

/** A generated query as query bar text; empty strings clear a field. */
export interface QueryText {
  filter: string;
  sort: string;
  projection: string;
  limit: string;
}

/** One line per field, in the editable mongosh syntax the query bar parses. */
export function toQueryText(query: GeneratedQuery): QueryText {
  const isEmpty = isJsonObject(query.filter) && Object.keys(query.filter).length === 0;
  return {
    filter: isEmpty ? "" : toShellSyntax(query.filter, 0),
    sort: query.sort ? toShellSyntax(query.sort, 0) : "",
    projection: query.projection ? toShellSyntax(query.projection, 0) : "",
    limit: query.limit === null ? "" : String(query.limit),
  };
}
