import { cn } from "@odin-db/ui/lib/utils";
import { ChevronsDownUp, ChevronsUpDown, Copy, Eye, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { IconAction } from "@/components/icon-action";
import type { JsonObject } from "@/lib/ejson-display";
import { DocumentCardEditor } from "./document-card-editor";
import { DocumentTree } from "./document-tree";
import { JsonDocument } from "./json-document";
import type { RowActions } from "./results-grid";

export function DocumentCard({
  format,
  id,
  row,
  selected,
  onSelect,
  actions,
}: {
  format: "tree" | "json";
  id: string;
  row: JsonObject;
  selected: boolean;
  onSelect: () => void;
  actions: RowActions;
}) {
  const { t } = useTranslation("results");
  const [expanded, setExpanded] = useState(false);
  const setField = actions.onSetField;
  // Remounting the tree applies "expand all" to every nested field.
  const [treeKey, setTreeKey] = useState(0);
  const [editing, setEditing] = useState(false);
  const replace = actions.onReplace;

  if (editing && replace) {
    return (
      // biome-ignore lint/a11y/useFocusableInteractive: focus moves into the editor's fields; the listbox keeps announcing the selected option.
      <div
        id={id}
        role="option"
        aria-selected={selected}
        className="rounded-md border border-primary/60 bg-background px-2 pt-1.5 pb-1.5 shadow-xs ring-1 ring-primary/30"
      >
        <DocumentCardEditor
          row={row}
          onSave={async (document) => {
            await replace(row, document);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
          onOpenEditor={() => {
            setEditing(false);
            actions.onOpen(row);
          }}
        />
      </div>
    );
  }

  return (
    // biome-ignore lint/a11y/useFocusableInteractive: focus stays on the listbox, which announces the selected option.
    <div
      id={id}
      role="option"
      aria-selected={selected}
      onMouseDown={onSelect}
      onContextMenu={onSelect}
      onDoubleClick={(event) => {
        // Double-clicking a field toggle should not open the editor.
        if ((event.target as HTMLElement).closest("button")) return;
        actions.onOpen(row);
      }}
      className={cn(
        "group relative rounded-md border bg-background px-2 py-1.5 shadow-xs",
        selected ? "border-primary/60 ring-1 ring-primary/30" : "hover:border-border/80",
      )}
    >
      <div className="absolute top-1.5 right-1.5 flex items-center gap-0.5 rounded-md bg-background opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        {format === "tree" && (
          <IconAction
            label={expanded ? t("view.collapseAll") : t("view.expandAll")}
            onClick={() => {
              setExpanded((value) => !value);
              setTreeKey((value) => value + 1);
            }}
          >
            {expanded ? <ChevronsDownUp /> : <ChevronsUpDown />}
          </IconAction>
        )}
        <IconAction label={t("row.copy")} onClick={() => actions.onCopy(row)}>
          <Copy />
        </IconAction>
        <IconAction
          label={actions.openMode === "view" ? t("row.view") : t("row.edit")}
          onClick={() => (replace && format === "tree" ? setEditing(true) : actions.onOpen(row))}
        >
          {actions.openMode === "view" ? <Eye /> : <Pencil />}
        </IconAction>
        {actions.onDelete && (
          <IconAction
            label={t("row.delete")}
            onClick={() => actions.onDelete?.(row)}
            className="hover:text-destructive"
          >
            <Trash2 />
          </IconAction>
        )}
      </div>
      {format === "tree" ? (
        <DocumentTree
          key={treeKey}
          document={row}
          expanded={expanded}
          onSetField={setField && ((field, value) => setField(row, field, value))}
        />
      ) : (
        <JsonDocument document={row} />
      )}
    </div>
  );
}
