import { Button } from "@odin-db/ui/components/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@odin-db/ui/components/tooltip";
import { cn } from "@odin-db/ui/lib/utils";
import { ChevronsDownUp, ChevronsUpDown, Copy, Eye, Pencil, Trash2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import type { JsonObject } from "@/lib/ejson-display";
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
          <CardAction
            label={expanded ? t("view.collapseAll") : t("view.expandAll")}
            onClick={() => {
              setExpanded((value) => !value);
              setTreeKey((value) => value + 1);
            }}
          >
            {expanded ? <ChevronsDownUp /> : <ChevronsUpDown />}
          </CardAction>
        )}
        <CardAction label={t("row.copy")} onClick={() => actions.onCopy(row)}>
          <Copy />
        </CardAction>
        <CardAction
          label={actions.openMode === "view" ? t("row.view") : t("row.edit")}
          onClick={() => actions.onOpen(row)}
        >
          {actions.openMode === "view" ? <Eye /> : <Pencil />}
        </CardAction>
        {actions.onDelete && (
          <CardAction
            label={t("row.delete")}
            onClick={() => actions.onDelete?.(row)}
            className="hover:text-destructive"
          >
            <Trash2 />
          </CardAction>
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

function CardAction({
  label,
  onClick,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={label}
          onClick={onClick}
          onMouseDown={(event) => event.stopPropagation()}
          className={cn("size-6 text-muted-foreground [&_svg]:size-3.5", className)}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
