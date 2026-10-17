import { ContextMenuItem, ContextMenuSeparator } from "@odin-db/ui/components/context-menu";
import { Copy, CopyPlus, Eye, Pencil, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { JsonObject } from "@/lib/ejson-display";
import type { RowActions } from "./results-grid";

/** Document commands, shared by the table and the list. */
export function RowMenuItems({ row, actions }: { row: JsonObject; actions: RowActions }) {
  const { t } = useTranslation("results");
  const { onOpen, openMode, onCopy, onDuplicate, onDelete } = actions;
  return (
    <>
      <ContextMenuItem onSelect={() => onOpen(row)}>
        {openMode === "view" ? <Eye /> : <Pencil />}
        {openMode === "view" ? t("row.view") : t("row.edit")}
      </ContextMenuItem>
      {onDuplicate && (
        <ContextMenuItem onSelect={() => onDuplicate(row)}>
          <CopyPlus />
          {t("row.duplicate")}
        </ContextMenuItem>
      )}
      <ContextMenuItem onSelect={() => onCopy(row)}>
        <Copy />
        {t("row.copy")}
      </ContextMenuItem>
      {onDelete && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onSelect={() => onDelete(row)}>
            <Trash2 />
            {t("row.delete")}
          </ContextMenuItem>
        </>
      )}
    </>
  );
}
