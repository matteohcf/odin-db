import type { JsonValue } from "@odin-db/bindings";
import { cn } from "@odin-db/ui/lib/utils";
import { useTranslation } from "react-i18next";
import { describeEJson, type EJsonKind } from "../../../lib/ejson-display";

const kindClass: Record<EJsonKind, string> = {
  null: "text-muted-foreground italic",
  boolean: "text-purple-600 dark:text-purple-400",
  number: "text-blue-600 dark:text-blue-400",
  string: "text-foreground",
  objectId: "text-amber-700 dark:text-amber-400",
  date: "text-teal-700 dark:text-teal-400",
  binary: "text-muted-foreground",
  document: "text-muted-foreground",
  array: "text-muted-foreground",
  other: "text-foreground",
};

export function EJsonCell({ value }: { value: JsonValue | undefined }) {
  const { t } = useTranslation("perfLab");
  if (value === undefined) return null;

  const { kind, text } = describeEJson(value);
  // Nested values are summarized in the grid; the full value belongs to the tree view.
  const label =
    kind === "document" && typeof value === "object" && value !== null
      ? t("cell.fields", { count: Object.keys(value).length })
      : kind === "array" && Array.isArray(value)
        ? t("cell.items", { count: value.length })
        : text;

  return <span className={cn("truncate font-mono text-xs", kindClass[kind])}>{label}</span>;
}
