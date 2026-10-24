import { cn } from "@odin-db/ui/lib/utils";
import { ChevronRight, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { kindTextClass } from "@/components/ejson-cell";
import { IconAction } from "@/components/icon-action";
import { type DraftField, kindOfText } from "../lib/document-draft";

export interface DraftFieldHandlers {
  onChange: (id: string, change: (field: DraftField) => DraftField | null) => void;
  onAddAfter: (id: string) => void;
  onAddInside: (parentId: string) => void;
  /** Problems by field id, from `checkDraft`. */
  problems: ReadonlyMap<string, string>;
}

/** One editable field of a document in place: its name, its value, or its nested fields. */
export function DraftFieldRow({
  field,
  depth,
  inArray,
  index,
  locked,
  handlers,
}: {
  field: DraftField;
  depth: number;
  inArray: boolean;
  index: number;
  /** `_id` cannot change: replacing a document keeps its identity. */
  locked: boolean;
  handlers: DraftFieldHandlers;
}) {
  const { t } = useTranslation("results");
  const [open, setOpen] = useState(true);
  const problem = handlers.problems.get(field.id);
  const structure = field.kind !== "value";
  const input =
    "h-5 rounded-sm bg-transparent px-1 outline-none hover:bg-accent/70 focus:bg-background focus:ring-1 focus:ring-ring disabled:hover:bg-transparent";

  return (
    <li>
      <div
        data-field-id={field.id}
        className={cn(
          "group/field flex min-w-0 items-center gap-0.5 rounded-sm pr-1",
          problem && "bg-destructive/10",
        )}
        style={{ paddingLeft: depth * 16 }}
        title={problem}
      >
        {structure ? (
          <button
            type="button"
            aria-expanded={open}
            aria-label={field.key}
            onClick={() => setOpen((value) => !value)}
            className="flex h-5 w-4 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
          >
            <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        {inArray ? (
          <span className="shrink-0 px-1 text-muted-foreground">{index}</span>
        ) : (
          <input
            aria-label={t("edit.fieldName")}
            value={field.key}
            disabled={locked}
            style={{ width: `calc(${Math.max(field.key.length, 3)}ch + 0.5rem)` }}
            spellCheck={false}
            onChange={(event) =>
              handlers.onChange(field.id, (current) => ({ ...current, key: event.target.value }))
            }
            className={cn(input, "shrink-0 text-foreground", locked && "text-muted-foreground")}
          />
        )}
        <span className="shrink-0 text-muted-foreground">:</span>
        {field.kind === "value" ? (
          <input
            aria-label={t("edit.fieldValue", { field: inArray ? index : field.key })}
            aria-invalid={problem !== undefined}
            value={field.text}
            disabled={locked}
            spellCheck={false}
            onChange={(event) =>
              handlers.onChange(field.id, (current) =>
                current.kind === "value" ? { ...current, text: event.target.value } : current,
              )
            }
            className={cn(
              input,
              "min-w-0 flex-1",
              locked ? "text-muted-foreground" : kindTextClass[kindOfText(field.text)],
            )}
          />
        ) : (
          <span className="flex-1 text-muted-foreground">
            {field.kind === "array" ? "[" : "{"}
            {!open && ` ${field.children.length} ${field.kind === "array" ? "]" : "}"}`}
          </span>
        )}
        {!locked && (
          <span className="flex shrink-0 opacity-0 group-focus-within/field:opacity-100 group-hover/field:opacity-100">
            <IconAction label={t("edit.addField")} onClick={() => handlers.onAddAfter(field.id)}>
              <Plus />
            </IconAction>
            <IconAction
              label={t("edit.removeField")}
              onClick={() => handlers.onChange(field.id, () => null)}
              className="hover:text-destructive"
            >
              <Trash2 />
            </IconAction>
          </span>
        )}
      </div>
      {structure && open && (
        <ul>
          {field.children.map((child, position) => (
            <DraftFieldRow
              key={child.id}
              field={child}
              depth={depth + 1}
              inArray={field.kind === "array"}
              index={position}
              locked={false}
              handlers={handlers}
            />
          ))}
          <li style={{ paddingLeft: (depth + 1) * 16 + 16 }}>
            <button
              type="button"
              onClick={() => handlers.onAddInside(field.id)}
              className="flex h-5 items-center gap-1 rounded-sm px-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Plus className="size-3" />
              {field.kind === "array" ? t("edit.addItem") : t("edit.addField")}
            </button>
          </li>
          <li className="text-muted-foreground" style={{ paddingLeft: depth * 16 + 20 }}>
            {field.kind === "array" ? "]" : "}"}
          </li>
        </ul>
      )}
    </li>
  );
}
