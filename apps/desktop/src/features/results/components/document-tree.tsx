import type { JsonValue } from "@odin-db/bindings";
import { cn } from "@odin-db/ui/lib/utils";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { kindTextClass } from "@/components/ejson-cell";
import { describeEJson, type JsonObject } from "@/lib/ejson-display";
import { FieldMenu } from "./field-menu";
import { InlineCellEditor } from "./inline-cell-editor";

/** Arrays longer than this show their first items and a "show all" button. */
const ARRAY_PREVIEW = 50;

/**
 * One document as an expandable tree: top-level fields are shown, nested
 * documents and arrays open on demand. EJSON wrappers (`{ $oid }`) are values.
 */
export function DocumentTree({
  document,
  expanded,
  onFilter,
  onSetField,
}: {
  document: JsonObject;
  expanded: boolean;
  /** Offers "filter by this value" in the field menu; the menu exists only with it. */
  onFilter?: ((path: string, value: JsonValue) => void) | undefined;
  /** Saves a top-level value edited in place (double-click). Omitted when read-only. */
  onSetField?: ((field: string, value: JsonValue) => Promise<void>) | undefined;
}) {
  const fields = (
    <ul className="font-mono text-xs leading-5">
      {Object.entries(document).map(([key, value]) => (
        <Field
          key={key}
          name={key}
          path={key}
          value={value}
          depth={0}
          expandAll={expanded}
          onSave={key === "_id" || !onSetField ? undefined : (next) => onSetField(key, next)}
        />
      ))}
    </ul>
  );
  return onFilter ? (
    <FieldMenu document={document} onFilter={onFilter}>
      {fields}
    </FieldMenu>
  ) : (
    fields
  );
}

function Field({
  name,
  path,
  value,
  depth,
  expandAll,
  index = false,
  onSave,
}: {
  name: string;
  path: string;
  value: JsonValue;
  depth: number;
  expandAll: boolean;
  index?: boolean;
  /** Top-level scalar fields of editable results: double-click edits in place. */
  onSave?: ((value: JsonValue) => Promise<void>) | undefined;
}) {
  const [editing, setEditing] = useState(false);
  const { t } = useTranslation("common");
  const { kind, text } = describeEJson(value);
  const structure = kind === "document" || kind === "array";
  const [open, setOpen] = useState(expandAll);
  const [showAll, setShowAll] = useState(false);

  const entries: [string, JsonValue][] =
    kind === "array" && Array.isArray(value)
      ? value.map((item, position) => [String(position), item])
      : kind === "document" && typeof value === "object" && value !== null && !Array.isArray(value)
        ? Object.entries(value)
        : [];
  const visible = showAll ? entries : entries.slice(0, ARRAY_PREVIEW);
  const summary =
    kind === "array"
      ? t("value.items", { count: entries.length })
      : t("value.fields", { count: entries.length });

  return (
    <li>
      <div
        data-path={path}
        className="flex min-w-0 items-start gap-1"
        style={{ paddingLeft: depth * 16 }}
      >
        {structure ? (
          <button
            type="button"
            aria-expanded={open}
            aria-label={name}
            onClick={() => setOpen((value) => !value)}
            className="flex h-5 w-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
          >
            <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <span className={cn("shrink-0", index ? "text-muted-foreground" : "text-foreground")}>
          {name}
          <span className="text-muted-foreground">:</span>
        </span>
        {structure ? (
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className={cn("text-left", kindTextClass[kind], "hover:underline")}
          >
            {open ? (kind === "array" ? "[" : "{") : summary}
          </button>
        ) : editing && onSave ? (
          <span className="min-w-0 flex-1">
            <InlineCellEditor
              value={value}
              onSave={async (next) => {
                await onSave(next);
                setEditing(false);
              }}
              onCancel={() => setEditing(false)}
              onMove={() => setEditing(false)}
            />
          </span>
        ) : (
          // biome-ignore lint/a11y/noStaticElementInteractions: double-click is a pointer shortcut; the document editor edits from the keyboard.
          <span
            className={cn(
              "min-w-0 break-all selectable",
              kindTextClass[kind],
              onSave && "cursor-text rounded-sm hover:bg-accent/60",
            )}
            onDoubleClick={(event) => {
              // Selects or edits this value instead of opening the whole document.
              event.stopPropagation();
              if (onSave) setEditing(true);
            }}
          >
            {text}
          </span>
        )}
      </div>
      {structure && open && (
        <ul>
          {visible.map(([key, item]) => (
            <Field
              key={key}
              name={key}
              path={`${path}.${key}`}
              value={item}
              depth={depth + 1}
              expandAll={expandAll}
              index={kind === "array"}
            />
          ))}
          {visible.length < entries.length && (
            <li style={{ paddingLeft: (depth + 1) * 16 + 20 }}>
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className="text-primary hover:underline"
              >
                {t("value.showAll", { count: entries.length })}
              </button>
            </li>
          )}
          <li className="text-muted-foreground" style={{ paddingLeft: depth * 16 + 20 }}>
            {kind === "array" ? "]" : "}"}
          </li>
        </ul>
      )}
    </li>
  );
}
