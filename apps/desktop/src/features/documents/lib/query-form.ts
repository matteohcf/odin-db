import { parseShellDocument } from "@/lib/shell-syntax";
import type { ResultsQuery } from "./results-controller";

export interface QueryForm {
  filter: string;
  sort: string;
  projection: string;
  skip: string;
  limit: string;
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
  | { ok: true; query: ResultsQuery }
  | { ok: false; errors: Partial<Record<QueryField, string>> };

/** Parses every field, collecting all errors at once so the user sees them together. */
export async function parseQueryForm(
  form: QueryForm,
  messages: { invalidNumber: string },
): Promise<ParsedQueryForm> {
  const errors: Partial<Record<QueryField, string>> = {};

  const document = async (field: "filter" | "sort" | "projection") => {
    if (form[field].trim() === "") return null;
    try {
      return await parseShellDocument(form[field]);
    } catch (error) {
      errors[field] = error instanceof Error ? error.message : String(error);
      return null;
    }
  };
  const number = (field: "skip" | "limit") => {
    const text = form[field].trim();
    if (text === "") return null;
    const value = Number(text);
    if (!Number.isSafeInteger(value) || value < 0 || value > 2 ** 31 - 1) {
      errors[field] = messages.invalidNumber;
      return null;
    }
    return value;
  };

  const [filter, sort, projection] = await Promise.all([
    document("filter"),
    document("sort"),
    document("projection"),
  ]);
  const skip = number("skip");
  // 0 means "no limit" in MongoDB; treat it like an empty field.
  const limit = number("limit") || null;

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, query: { filter: filter ?? {}, sort, projection, skip, limit } };
}
