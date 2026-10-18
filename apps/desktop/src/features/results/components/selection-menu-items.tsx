import { ContextMenuItem, ContextMenuSeparator } from "@odin-db/ui/components/context-menu";
import { GitCompareArrows, PencilLine, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { JsonObject } from "@/lib/ejson-display";
import { CopyAsMenu } from "./copy-as-menu";
import type { RowActions } from "./results-grid";

/** Commands for several selected documents at once. */
export function SelectionMenuItems({
  rows,
  actions,
  onCompare,
}: {
  rows: JsonObject[];
  actions: RowActions;
  onCompare: (rows: readonly JsonObject[]) => void;
}) {
  const { t } = useTranslation("results");
  return (
    <>
      <CopyAsMenu value={rows} label={t("rows.copy", { count: rows.length })} />
      {rows.length === 2 && (
        <ContextMenuItem onSelect={() => onCompare(rows)}>
          <GitCompareArrows />
          {t("compare.menu")}
        </ContextMenuItem>
      )}
      {actions.onUpdateMany && (
        <ContextMenuItem onSelect={() => actions.onUpdateMany?.(rows)}>
          <PencilLine />
          {t("rows.update", { count: rows.length })}
        </ContextMenuItem>
      )}
      {actions.onDeleteMany && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onSelect={() => actions.onDeleteMany?.(rows)}>
            <Trash2 />
            {t("rows.delete", { count: rows.length })}
          </ContextMenuItem>
        </>
      )}
    </>
  );
}
