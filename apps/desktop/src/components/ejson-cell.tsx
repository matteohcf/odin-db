import type { JsonValue } from "@odin-db/bindings";
import { cn } from "@odin-db/ui/lib/utils";
import { useTranslation } from "react-i18next";
import { compactEJson, describeEJson, type EJsonKind } from "@/lib/ejson-display";
import { formatRelativeTime } from "@/lib/format";
import { momentOf } from "@/lib/value-hints";

export const kindTextClass: Record<EJsonKind, string> = {
  null: "text-type-null italic",
  boolean: "text-type-boolean",
  number: "text-type-number",
  string: "text-type-string",
  objectId: "text-type-object-id",
  date: "text-type-date",
  binary: "text-type-binary",
  document: "text-type-structure",
  array: "text-type-structure",
  other: "text-foreground",
};

/** One BSON value in a grid cell: typed color, nested values summarized. */
export function EJsonCell({ value }: { value: JsonValue | undefined }) {
  const { t, i18n } = useTranslation("common");
  if (value === undefined) return null;
  const moment = momentOf(value);
  // Dates and ObjectIds also say when, in local time and relative to now.
  const when = moment
    ? `\n${t(moment.kind === "objectId" ? "value.created" : "value.localTime", {
        date: moment.date.toLocaleString(i18n.language),
        relative: formatRelativeTime(moment.date.getTime(), Date.now(), i18n.language),
      })}`
    : "";

  const { kind, text } = compactEJson(value);
  const label =
    kind === "document" && typeof value === "object" && value !== null
      ? t("value.fields", { count: Object.keys(value).length })
      : kind === "array" && Array.isArray(value)
        ? t("value.items", { count: value.length })
        : text;

  return (
    <span
      className={cn("truncate font-mono text-xs", kindTextClass[kind], text === "" && "italic")}
      // The exact mongosh form, e.g. NumberLong("5"), stays one hover away.
      title={`${describeEJson(value).text}${when}`}
    >
      {text === "" && kind === "string" ? '""' : label}
    </span>
  );
}
