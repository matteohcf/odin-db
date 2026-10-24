import type { CollectionOptions } from "@odin-db/bindings";
import { parseShellDocument } from "@/lib/shell-syntax";

export const COLLECTION_TYPES = ["standard", "capped", "timeSeries", "clustered"] as const;
export type CollectionType = (typeof COLLECTION_TYPES)[number];
export const GRANULARITIES = ["seconds", "minutes", "hours"] as const;

/** The create collection form, as typed. */
export interface CollectionDraft {
  type: CollectionType;
  sizeMb: string;
  maxDocuments: string;
  timeField: string;
  metaField: string;
  granularity: (typeof GRANULARITIES)[number] | "";
  expireAfterSeconds: string;
  collation: string;
}

export const emptyDraft: CollectionDraft = {
  type: "standard",
  sizeMb: "",
  maxDocuments: "",
  timeField: "",
  metaField: "",
  granularity: "",
  expireAfterSeconds: "",
  collation: "",
};

export type DraftField = keyof CollectionDraft;
export type DraftErrors = Partial<Record<DraftField, string>>;

/** Turns the form into options for `create_collection`, or the fields to fix. */
export async function toCollectionOptions(
  draft: CollectionDraft,
  messages: { required: string; invalidNumber: string },
): Promise<{ ok: true; options: CollectionOptions } | { ok: false; errors: DraftErrors }> {
  const errors: DraftErrors = {};
  const number = (field: "sizeMb" | "maxDocuments" | "expireAfterSeconds", required = false) => {
    const text = draft[field].trim();
    if (text === "") {
      if (required) errors[field] = messages.required;
      return null;
    }
    const value = Number(text);
    const whole = field !== "sizeMb";
    if (!Number.isFinite(value) || value <= 0 || (whole && !Number.isSafeInteger(value))) {
      errors[field] = messages.invalidNumber;
      return null;
    }
    return value;
  };

  let kind: CollectionOptions["kind"] = { kind: "standard" };
  if (draft.type === "capped") {
    const sizeMb = number("sizeMb", true);
    const maxDocuments = number("maxDocuments");
    kind = { kind: "capped", sizeBytes: Math.round((sizeMb ?? 0) * 1024 * 1024), maxDocuments };
  } else if (draft.type === "timeSeries") {
    if (draft.timeField.trim() === "") errors.timeField = messages.required;
    kind = {
      kind: "timeSeries",
      timeField: draft.timeField.trim(),
      metaField: draft.metaField.trim() || null,
      granularity: draft.granularity || null,
      expireAfterSeconds: number("expireAfterSeconds"),
    };
  } else if (draft.type === "clustered") {
    kind = { kind: "clustered", expireAfterSeconds: number("expireAfterSeconds") };
  }

  let collation = null;
  const text = draft.collation.trim();
  if (text !== "") {
    try {
      collation = await parseShellDocument(text.startsWith("{") ? text : `{ ${text} }`);
    } catch (error) {
      errors.collation = error instanceof Error ? error.message : String(error);
    }
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, options: { kind, collation } };
}
