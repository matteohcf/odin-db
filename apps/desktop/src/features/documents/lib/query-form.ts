import type { FindRequest } from "@odin-db/bindings";
import { parseShellDocument } from "@/lib/shell-syntax";

/** A find without its page size, which the results controller chooses. */
export type FindQuery = Omit<FindRequest, "batchSize">;

export interface QueryForm {
  filter: string;
  sort: string;
  projection: string;
  skip: string;
  limit: string;
  // Optional: queries saved or remembered before these existed have none (ADR-0052).
  collation?: string;
  /** An index name, or its keys. */
  hint?: string;
  /** Empty takes the time limit from settings; 0 lets the query run as long as it needs. */
  maxTimeMS?: string;
}

export type QueryField = keyof QueryForm;

export const emptyQueryForm: QueryForm = {
  filter: "",
  sort: "",
  projection: "",
  skip: "",
  limit: "",
};

export type ParsedQueryForm =
  | { ok: true; query: FindQuery }
  | { ok: false; errors: Partial<Record<QueryField, string>> };

/** Parses every field, collecting all errors at once so the user sees them together. */
export async function parseQueryForm(
  form: QueryForm,
  messages: { invalidNumber: string },
): Promise<ParsedQueryForm> {
  const errors: Partial<Record<QueryField, string>> = {};

  const document = async (field: "filter" | "sort" | "projection" | "collation") => {
    const text = (form[field] ?? "").trim();
    if (text === "") return null;
    try {
      // Braces are optional, as in Compass: `status: "active"` is a document body.
      return await parseShellDocument(text.startsWith("{") ? text : `{ ${text} }`);
    } catch (error) {
      errors[field] = error instanceof Error ? error.message : String(error);
      return null;
    }
  };
  const number = (field: "skip" | "limit" | "maxTimeMS") => {
    const text = (form[field] ?? "").trim();
    if (text === "") return null;
    const value = Number(text);
    if (!Number.isSafeInteger(value) || value < 0 || value > 2 ** 31 - 1) {
      errors[field] = messages.invalidNumber;
      return null;
    }
    return value;
  };

  const hint = async () => {
    const text = (form.hint ?? "").trim();
    if (text === "") return null;
    if (!text.startsWith("{")) return text.replace(/^["']|["']$/g, "");
    try {
      return await parseShellDocument(text);
    } catch (error) {
      errors.hint = error instanceof Error ? error.message : String(error);
      return null;
    }
  };

  const [filter, sort, projection, collation, index] = await Promise.all([
    document("filter"),
    document("sort"),
    document("projection"),
    document("collation"),
    hint(),
  ]);
  const skip = number("skip");
  // 0 means "no limit" in MongoDB; treat it like an empty field.
  const limit = number("limit") || null;
  const maxTimeMs = number("maxTimeMS");

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const options = {
    ...(collation ? { collation } : {}),
    ...(index ? { hint: index } : {}),
    ...(maxTimeMs !== null ? { maxTimeMs } : {}),
  };
  return {
    ok: true,
    query: {
      filter: filter ?? {},
      sort,
      projection,
      skip,
      limit,
      ...(Object.keys(options).length > 0 ? { options } : {}),
    },
  };
}
